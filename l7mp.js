// L7mp: A programmable L7 meta-proxy
//
// Copyright 2019 by its authors.
// Some rights reserved. See AUTHORS.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the 'Software'), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
// ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

const os         = require('os');
const fs         = require('fs');

const parseArgs  = require('minimist');
const util       = require('util');
const log        = require('npmlog');
const path       = require('path');
const YAML       = require('yamljs');

const Listener   = require('./listener.js').Listener;
const Cluster    = require('./cluster.js').Cluster;
const Session    = require('./session.js').Session;
const Rule       = require('./rule.js').Rule;
const Route      = require('./route.js').Route;

const hostname   = os.hostname();

global.dump = function dump(o){
    return util.inspect(o, {compact: 100000, breakLength: Infinity, depth: 50});
}

class L7mp {
    constructor() {
        this.static_config;
        // object hierarchy
        this.admin      = {};
        this.listeners  = [];
        this.clusters   = [];
        this.rules      = [];
        this.sessions   = [];
        this.routes     = [];
        // this.transforms = [];
    }

    toJSON(){
        log.silly('L7MP.toJSON:', `"${this.name}"`);
        return {
            admin:      this.getAdmin(),
            listeners:  this.listeners,
            clusters:   this.clusters,
            rules:      this.rules,
            sessions:   this.sessions,
            routes:     this.routes,
            // transforms: this.transforms,
        };
    }

    async route(metadata, listener, priv){
        log.info('L7mp.route:', `New session "${metadata.name}"`,
                 `listener: ${listener.origin.name}`);

        let s = this.addSession(metadata, listener.origin, priv);

        // match rules
        var rules = s.listener.rules;
        var action;
        for(let i = 0; i < rules.length; i++){
            action = rules[i].apply(s)
            if (action) break;
        }

        try {
            this.addRoute(s, listener, action);
        } catch(e) {
            log.warn('L7mp.route', `Session "${s.name}" rejected:`, e);
            listener.origin.reject(s, e);
            this.deleteSession(s.name);
            return;
        }

        if(s.route.type === 'session'){
            log.warn('L7mp.route', 'TODO: Fully implement session mode');
            await s.route.destination.origin.connect(s);
            // s.metadata.status = 'ESTABLISHED';
            l7mp.deleteSession(s.name);
            return;
        }

        s.route.pipeline(s).then(
            // set up event listeners
            (route) => s.setRoute(route),
            // on error
            (e) => {
                log.warn('L7mp.route', `${e.message}`);
                listener.origin.reject(s, e);
                this.deleteSession(s.name);
                return;
            }
        );
    }

    readConfig(config){
        log.silly('L7mp.readConfig', config);
        // may throw
        if(path.extname(config).toLowerCase() === '.yaml')
            this.static_config = YAML.parse(fs.readFileSync(config, 'utf8'));
        else
            this.static_config = JSON.parse(fs.readFileSync(config));
        this.applyAdmin(this.static_config.admin);
    }

    run(){
        log.silly('L7mp.run');
        if('listeners' in this.static_config){
            this.static_config.listeners.forEach(
                (l) => this.addListener(l)
            );
        }

        if('clusters' in this.static_config){
            this.static_config.clusters.forEach(
                (c) => this.addCluster(c)
            );
        }

        if('rules' in this.static_config){
            this.static_config.rules.forEach(
                (r) => this.addRule(r)
            );
        }
    }

    applyAdmin(admin) {
        log.info('L7mp.applyAdmin', dump(admin));
        this.admin.log_level = log.level = 'log_level' in admin ?
            admin.log_level : log.level;
        if('log_file' in admin){
            this.admin.log_file = admin.log_file;
            switch(admin.log_file){
            case 'stdout':
                this.admin.log_stream = process.stdout;
                break;
            case 'stderr':
                this.admin.log_stream = process.stderr;
                break;
            default:
                this.admin.log_stream =
                    fs.createWriteStream(admin.log_file);
            }
        }
        if('access_log_path' in admin){
            this.admin.access_log_path = admin.access_log_path;
            log.warn('L7mp.applyAdmin: access_log_path', 'TODO');
        }
    }

    getAdmin(){
        log.silly('L7mp.getAdmin');
        var admin = { log_level: this.admin.log_level };
        if(this.admin.log_file) admin.log_file = this.admin.log_file;
        if(this.admin.access_log_path)
            admin.access_log_path = this.admin.access_log_path;
        return admin;
    }

    addListener(l) {
        log.info('L7mp.addListener', dump(l));

        if(this.getListener(l.name)){
            let e = `Listener "${l.name}" already defined`;
            log.warn(`L7mp.addListener:`, e );
            throw new Error(e);
        }

        var li = Listener.create(l);
        li.on('connection', (m, l, p) => this.route(m, l, p));
        this.listeners.push(li);

        l.rules.forEach( (r) => {
            if(typeof r === 'string'){
                // this is a rule name, substitute ref to Rule
                var ru = this.getRule(r.name);
                if(ru){
                    li.rules.push(ru);
                } else {
                    let e = 'Cannot find named rule "${r}"';
                    log.warn('L7mp.addListener', e);
                    throw new Error(e);
                }
            } else {
                li.rules.push(this.addRule(r));
            }
        });

        return li;
    }

    getListener(n){
        log.silly('L7mp.getListener:', n);
        return this.listeners.find( ({name}) => name === n );
    }

    deleteListener(n){
        log.info('L7mp.deleteListener: TODO: actually delete the listener!');
        let i = this.listeners.findIndex( ({name}) => name === n);
        if(i >= 0){
            this.listeners.splice(i, 1);
        } else {
            let e = `Unknown listener "${n}"`;
            log.warn(`L7mp.deleteListener:`, e );
            throw new Error(e);
        }
    }

    addCluster(c) {
        log.info('L7mp.addCluster', dump(c));

        if(this.getCluster(c.name)){
            let e = `Cluster "${c.name}" already defined`;
            log.warn('L7mp.addCluster', e);
            throw new Error(e);
        }

        var cl = Cluster.create(c);
        this.clusters.push(cl);
        return cl;
    }

    getCluster(n){
        log.silly('L7mp.getCluster:', n);
        return this.clusters.find( ({name}) => name === n );
    }

    deleteCluster(n){
        log.info('L7mp.deleteCluster: TODO: actually delete the cluster!');
        let i = this.clusters.findIndex( ({name}) => name === n);
        if(i >= 0){
            this.clusters.splice(i, 1);
        } else {
            let e = `Unknown cluster "${n}"`;
            log.warn(`L7mp.deleteCluster:`, e );
            throw new Error(e);
        }
    }

    addRule(r) {
        log.info('L7mp.addRule', dump(r));

        if(r.name && this.getRule(r.name)){
            let e = `Rule "${r.name}" already defined`;
            log.warn('L7mp.addRule', e);
            throw new Error(e);
        }

        var ru = Rule.create(r);
        this.rules.push(ru);
        return ru;
    }

    getRule(n){
        log.silly('L7mp.getRule:', n);
        return this.rules.find( ({name}) => name === n );
    }

    // internal, not to be called from the API
    addSession(metadata, listener, priv){
        log.silly('L7mp.addSession:', `Session: ${metadata.name}`);
        var i = 0;
        do{
            if(i > 20){
                let e = 'Could not insert session after 20 iterations'
                log.warn('L7mp.addSession', e);
                throw new Error(e);
            }
            var name = metadata.name + (i > 0 ? `_${i}` : '');
            i++;
        } while(this.getSession(name));

        metadata.name = name;
        let se = new Session(metadata, listener, priv)
        this.sessions.push(se);
        return se;
    }

    deleteSession(n){
        log.info('L7mp.deleteSession:', `"${n}"`,
                 'TODO: actually delete the session!');
        let i = this.sessions.findIndex( ({name}) => name === n);
        if(i < 0){
            let e = `Unknown session "${n}"`;
            log.warn(`L7mp.deleteSession:`, e );
            throw new Error(e);
        }

         try{
            this.deleteRoute(this.sessions[i].route.name);
        } catch(e){
            log.error('catch', e);
        }
        this.sessions.splice(i, 1);
    }

    getSession(n){
        log.silly('L7mp.getSession:', n);
        return this.sessions.find( ({name}) => name === n );
    }

    // internal, not to be called from the API
    addRoute(s, l, a){
        log.silly('L7mp.addRoute:', `Session: ${s.name}`);
        if(!a) throw `No matching rule`;
        // deep copy!
        let r = { ... a.route};

        if(!r) throw `No route in matching rule`;
        if(!r.cluster)
            throw `Invalid route: Empty cluster`;

        let cluster = this.getCluster(r.cluster);
        if(!cluster)
            throw `Unknown cluster in route: "${r.cluster}"`;
        r.cluster  = { origin: cluster };
        r.listener = l;

        let ro = Route.create(r);
        log.silly('L7mp.addRoute:', `${ro.name} created`);

        for(let dir of ['ingress', 'egress']){
            if(!r[dir]) continue;
            r[dir].forEach( (cname) => {
                let c = this.getCluster(cname);
                if(!c)
                    throw `Unknown transform cluster "${cname}" in ` +
                    `"${dir}" route`;

                ro.chain[dir].push({ origin: c });
                this.checkRoute(ro, c);
            });
        }
        this.checkRoute(ro, cluster);

        s.setRoute(ro);
        this.routes.push(ro);

        return ro;
    }

    getRoute(n){
        log.silly('L7mp.getRoute:', n);
        return this.routes.find( ({name}) => name === n );
    }

    // internal, not to be called from the API
    deleteRoute(n){
        log.silly('L7mp.deleteRoute:', n);
        let i = this.routes.findIndex(({name}) => name === n);
        if(i >= 0){
            this.routes[i].end();
            this.routes.splice(i, 1);
            return;
        }
    }

    checkRoute(r, to){
        // incompatible: session with everyting: this is an error
        if(r.type === 'session' && to.type !== 'session')
            throw `Incompatible streams: session stream routed to` +
            `a ${to.type} stream`;

        // incompatible: datagram to session: warn
        if(r.type === 'datagram' && to.type !== 'datagram'){
            log.warn('L7mp.addRoute', `Stream down-conversion: datagram-stream`,
                     `routed to a "${to.type}"-type stream "${to.name}":`,
                     'Can no longer enforce datagam boundaries');
            r.type = 'stream';
        }
    }

};

var usage = 'l7mp -c <static_config>'
var argv = parseArgs(process.argv.slice(2));
if(!('c' in argv)){
    console.error(usage);
    process.exit(1);
}

log.stream = process.stderr;
log.on('log.error', (msg) => {
    console.error(`Error: ${msg.prefix}: ${msg.message}`);
    process.exit(1);
});

global.l7mp = new L7mp();
var config = argv.c;
try {
    l7mp.readConfig(config);
} catch(e) {
    log.error(`Could not read static configuration ${config}`, e);
}

// applies config.admin

// override loglevel
log.level = 'l' in argv ? argv.l : 'silly';

if(!l7mp.static_config)
    log.error('No static configuration found');

l7mp.run();
