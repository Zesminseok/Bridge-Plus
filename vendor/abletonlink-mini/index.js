'use strict';

const native = require('bindings')('abletonlink_mini');
module.exports = native.Link;
module.exports.Link = native.Link;
