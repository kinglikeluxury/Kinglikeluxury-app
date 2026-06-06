"use strict";
// Minimal fast-xml-parser stub.
// @google-cloud/storage only uses XMLParser and XMLBuilder in transfer-manager.js,
// which handles bulk multi-file uploads. Our objectStorage.ts never instantiates
// TransferManager, so parse() and build() are never invoked at runtime.
// This stub satisfies the require() at module-load time without any npm download.

class XMLParser {
  constructor(options) { this.options = options || {}; }
  parse(xmlData) { return {}; }
}

class XMLBuilder {
  constructor(options) { this.options = options || {}; }
  build(obj) { return ""; }
}

module.exports = { XMLParser, XMLBuilder };
module.exports.XMLParser = XMLParser;
module.exports.XMLBuilder = XMLBuilder;
