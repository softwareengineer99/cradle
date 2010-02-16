var path = require('path'),
    sys = require('sys'),
    assert = require('assert'),
    events = require('events'),
    http = require('http');

require.paths.unshift(path.join(__dirname, '..', 'lib'),
                      path.join(__dirname, 'vendor', 'vows', 'lib')); 

var vows = require('vows'),
    cradle = require('cradle');

vows.options.Emitter = cradle.Promise;

function status(code) {
    return function (res) {
        assert.equal(res._headers.status, code);
    };
}

var client = http.createClient(5984, '127.0.0.1');

function r(method, url, doc) {
    var promise = new(events.Promise);
    var request = client.request(method, url, {});

    if (doc) { request.sendBody(JSON.stringify(doc)) }

    request.finish(function (res) {
        var body = '';

        res.setBodyEncoding('utf8');
        res.addListener('body', function (chunk) {
            body += (chunk || '');
        }).addListener('complete', function () {
            var obj, response;

            try { obj = JSON.parse(body) }
            catch (e) { return promise.emitError(e) }

            promise.emitSuccess(obj);
        });
    });
    return promise;
}

cradle.setup({ usePromises: true });

vows.tell("Cradle", {
    setup: function () {
        r('GET', '/_all_dbs').wait().forEach(function (db) {
            r('DELETE', '/' + db).wait();
        });
        r('PUT', '/rabbits');
        r('PUT', '/pigs').wait();
        r('PUT', '/pigs/_design/pigs', {
            _id: '_design/pigs', views: {
                all: { map: "function (doc) { if (doc.color) emit(null, doc) }" }
            }
        });
        r('PUT', '/pigs/mike', {color: 'pink'});
        r('PUT', '/rabbits/alex', {color: 'blue'});
        r('PUT', '/pigs/bill', {color: 'blue'}).wait();
    },
    "Default connection settings": {
        setup: function () {
            cradle.setup({
                host: "http://cloudhead.io",
                port: 4242,
                milk: 'white'
            });
            return new(cradle.Connection);
        },
        "should be carried on to new Connections": function (c) {
            assert.equal(c.host, "http://cloudhead.io");
            assert.equal(c.port, 4242);
            assert.equal(c.options.milk, 'white');
            assert.equal(c.options.cache, true);
        },
        "with just a {} passed to a new Connection object": {
            setup: function () { return new(cradle.Connection)({milk: 'green'}) },
            "should override the defaults": function (c) {
                assert.equal(c.options.milk, 'green');
                assert.equal(c.port, 4242);
            }
        },
        "with a host and port passed to Connection": {
            setup: function () { return new(cradle.Connection)("255.255.0.0", 9696) },
            "should override the defaults": function (c) {
                assert.equal(c.host, '255.255.0.0');
                assert.equal(c.port, 9696);
            }
        },
        "with a host and port passed as a string to Connection": {
            setup: function () { return new(cradle.Connection)("8.8.8.8:4141") },
            "should override the defaults": function (c) {
                assert.equal(c.host, '8.8.8.8');
                assert.equal(c.port, 4141);
            }
        },
        "with a host, port and options passed to Connection": {
            setup: function () { return new(cradle.Connection)("4.4.4.4", 911, {raw: true}) },
            "should override the defaults": function (c) {
                assert.equal(c.host, '4.4.4.4');
                assert.equal(c.port, 911);
                assert.equal(c.options.raw, true);
            }
        }
    },

    //
    // Cache
    //
    "A Cradle connection (cache)": {
        setup: function () {
            return new(cradle.Connection)('127.0.0.1', 5984, {cache: true}).database('pigs');
        },
        "save()": {
            setup: function (db) {
                var promise = new(events.Promise);
                db.save('bob', {color: 'orange'})
                  .addCallback(function () { promise.emitSuccess(db) });
                return promise;
            },
            "should write through the cache": function (db) {
                assert.ok(db.cache.has('bob'));
            },
            "and": {
                setup: function (db) {
                    return db.save('bob', {size: 12});
                },
                "return a 201": status(201),
                "allow an overwrite": function (res) {
                   assert.match(res.rev, /^2/);
                }
            }
        },
        "remove()": {
            setup: function (db) {
                var promise = new(events.Promise);
                db.save('bruno', {}).addCallback(function () {
                    promise.emitSuccess(db);
                });
                return promise;
            },
            "shouldn't ask for a revision": {
                setup: function (db) {
                    var promise = new(events.Promise);
                    db.remove('bruno').addCallback(function () { promise.emitSuccess(db) });
                    return promise;
                },
                "and should purge the cache": function (db) {
                    assert.equal(db.cache.has('bruno'), false);
                },
                "and raise an exception if you use remove() without a rev": function (db) {
                    //assert.throws(db.remove('bruno'), Error);
                }
            }
        }
    },
    "A connection with continuation passing style": {
        setup: function () {
            //var promise = new(events.Promise);
            //var c = new(cradle.Connection)({usePromises: false});
            //c.database('badgers').save('robin', {})(function (res) {
            //    promise.emitSuccess(res); 
            //});
            //return promise;
        },
        "should send requests one after the other": function (res) {
            //assert.ok(res.ok);
        }
    },
    "A Cradle connection (no-cache)": {
        setup: function () {
            return new(cradle.Connection)('127.0.0.1', 5984, {cache: false});
        },
        "queried for information": {
            setup: function (c) { return c.info() },

            "returns a 200": status(200),
            "returns the version number": function (info) {
                assert.ok(info);
                assert.match(info.version, /\d+\.\d+\.\d+/);
            }
        },
        "getting the list of databases": {
            setup: function (c) { return c.databases() },
            "returns an empty list": function (dbs) {
                assert.equal(dbs.length, 2);
                assert.ok(dbs instanceof Array);
            }
        },
        "create()": {
            setup: function (c) { return c.database('badgers').create() },
            "returns a 201": status(201),
            "creates a database": {
                setup: function (res, c) { return c.database('badgers').exists() },
                "it exists": function (res) { assert.ok(res) }
            }
        },
        "destroy()": {
            setup: function (c) { return c.database('rabbits').destroy() },
            "returns a 200": status(200),
            "destroys a database": {
                setup: function (res, c) { return c.database('rabbits').exists() },
                "it doesn't exist anymore": function (res) { assert.ok(! res) }
            }
        },
        "a database": {
            setup: function (c) { return c.database('pigs') },

            "info()": {
                setup: function (db) { return db.info() },
                "returns a 200": status(200),
                "returns database info": function (info) {
                    assert.equal(info['db_name'], 'pigs');
                }
            },
            "fetching a document by id (GET)": {
                setup: function (db) { return db.get('mike') },
                "returns a 200": status(200),
                "returns the document": function (res) {
                    assert.equal(res.id, 'mike');
                }
            },
            "save() with an id and document": {
                "should PUT the document, with the id": {
                    setup: function (db) {
                        return db.save('joe', {gender: 'male'});
                    },
                    "returns a 201": status(201),
                    "returns the revision": function (res) {
                        assert.ok(res.rev);
                    }
                },
                "without an id (POST)": {}
            },
            "save() with a _design id": {
                "should save the doc as a design": {
                    setup: function (db) {
                        return db.save('_design/horses', {
                            all: {
                                map: function (doc) {
                                    if (doc.speed == 72) emit(null, doc);
                                }
                            }
                        });
                    },
                    "returns a 201": status(201),
                    "returns the revision": function (res) {
                        assert.ok(res.rev);
                    },
                    "which can be queried": {
                        setup: function (res, db) {
                            return db.view('horses/all');
                        },
                        "returns a 200": status(200)
                    }
                }
            },
            "calling save() with an array": {
                setup: function (db) {
                    return db.save([{_id: 'tom'}, {_id: 'flint'}]);
                },
                "returns an array of document ids and revs": function (res) {
                    assert.equal(res[0].id, 'tom');
                    assert.equal(res[1].id, 'flint');
                },
                "should bulk insert the documents": {
                    setup: function (res, db) {
                        var promise = new(events.Promise);
                        db.get('tom').addCallback(function (tom) {
                            db.get('flint').addCallback(function (flint) {
                                promise.emitSuccess(tom, flint);
                            });
                        });
                        return promise;
                    },
                    "which can then be retrieved": function (tom, flint) {
                        assert.ok(tom._id);
                        assert.ok(flint._id);
                    }
                }
            },
            "getting all documents": {
                setup: function (db) {
                    return db.all();
                },
                "returns a 200": status(200),
                "returns a list of all docs": function (res) {
                    assert.ok(res.rows);
                }
            },
            "updating a document (PUT)": {
                setup: function (db) {
                    var promise = new(events.Promise);
                    db.get('mike').addCallback(function (doc) {
                        db.save('mike', doc.rev,
                            {color: doc.color, age: 13}).addCallback(function (res) {
                            promise.emitSuccess(res); 
                        });
                    });
                    return promise;
                },
                "returns a 201": status(201),
                "returns the revision": function (res) {
                    assert.ok(res.rev);
                    assert.match(res.rev, /^2/);
                },

                "returns the updated document": function (res) {
                    //assert.equal(res.age, 13);
                }
            },
            "deleting a document (DELETE)": {
                setup: function (db) {
                    var promise = new(events.Promise);
                    db.get('bill').addCallback(function (res) {
                        db.remove('bill', res.rev).addCallback(function (res) {
                            promise.emitSuccess(res);
                        });
                    });
                    return promise;
                },
                "returns a 200": status(200)
            },
            "querying a view": {
                setup: function (db) {
                    return db.view('pigs/all');
                },
                "returns a 200": status(200),
                "returns view results": function (res) {
                    assert.ok(res.rows);
                    assert.equal(res.rows.length, 2);
                },
                "with options": {
                
                },
                "with a start & end key": {
                
                }
            }
        }
    }
});