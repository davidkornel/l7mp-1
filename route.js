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

const log          = require('npmlog');
const EventEmitter = require('events').EventEmitter;

//------------------------------------
//
// Route
//
//------------------------------------

const retry_default_policy = {
    retry_on: 'never',
    num_retries: 1,
    timeout: 2000,
};

class Route {
    constructor(r){
        this.name        = r.name || `Route_${Route.index++}`;  // id
        this.destination = r.destination || r.cluster ;
        this.ingress     = r.ingress;
        this.egress      = r.egress;
        this.retry       = r.retry || retry_default_policy;
    }

    toJSON(){
        log.silly('Route.toJSON:', `"${this.name}"`);
        return {
            name:        this.name,
            destination: this.destination,
            ingress:     this.ingress,
            egress:      this.egress,
            retry:       this.retry,
        };
    }

};
Route.index = 0;

Route.create = (r) => {
    log.silly("Route.create:", r.name);
    return new Route(r);
}

module.exports.Route = Route;
