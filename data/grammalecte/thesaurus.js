// Grammalecte - Thésaurus

/* jshint esversion:6 */
/* jslint esversion:6 */
/* global __dirname */

"use strict";


// String
/*jslint esversion: 6*/

if (String.prototype.grammalecte === undefined) {
    String.prototype.gl_count = function (sSearch, bOverlapping) {
        // http://jsperf.com/string-ocurrence-split-vs-match/8
        if (sSearch.length <= 0) {
            return this.length + 1;
        }
        let nOccur = 0;
        let iPos = 0;
        let nStep = (bOverlapping) ? 1 : sSearch.length;
        while ((iPos = this.indexOf(sSearch, iPos)) >= 0) {
            nOccur++;
            iPos += nStep;
        }
        return nOccur;
    };
    String.prototype.gl_isDigit = function () {
        return (this.search(/^[0-9⁰¹²³⁴⁵⁶⁷⁸⁹]+$/) !== -1);
    };
    String.prototype.gl_isAlpha = function () {
        return (this.search(/^[a-zà-öA-Zø-ÿÀ-ÖØ-ßĀ-ʯﬀ-ﬆᴀ-ᶿ]+$/) !== -1);
    };
    String.prototype.gl_isLowerCase = function () {
        return (this.search(/^[a-zà-öø-ÿﬀ-ﬆ0-9 '’-]+$/) !== -1);
    };
    String.prototype.gl_isUpperCase = function () {
        return (this.search(/^[A-ZÀ-ÖØ-ßŒ0-9 '’-]+$/) !== -1  &&  this.search(/^[0-9]+$/) === -1);
    };
    String.prototype.gl_isTitle = function () {
        return (this.search(/^[A-ZÀ-ÖØ-ßŒ][a-zà-öø-ÿﬀ-ﬆ '’-]+$/) !== -1);
    };
    String.prototype.gl_toCapitalize = function () {
        return this.slice(0,1).toUpperCase() + this.slice(1).toLowerCase();
    };
    String.prototype.gl_expand = function (oMatch) {
        let sNew = this;
        for (let i = 0; i < oMatch.length ; i++) {
            let z = new RegExp("\\\\"+parseInt(i), "g");
            sNew = sNew.replace(z, oMatch[i]);
        }
        return sNew;
    };
    String.prototype.gl_trimRight = function (sChars) {
        let z = new RegExp("["+sChars+"]+$");
        return this.replace(z, "");
    };
    String.prototype.gl_trimLeft = function (sChars) {
        let z = new RegExp("^["+sChars+"]+");
        return this.replace(z, "");
    };
    String.prototype.gl_trim = function (sChars) {
        let z1 = new RegExp("^["+sChars+"]+");
        let z2 = new RegExp("["+sChars+"]+$");
        return this.replace(z1, "").replace(z2, "");
    };

    String.prototype.grammalecte = true;
}



if (typeof(process) !== 'undefined') {
    var helpers = require("../graphspell/helpers.js");
}


var thesaurus = {
    _dWord: new Map(),

    bInit: false,
    init: function (sJSONData1, sJSONData2) {
        try {
            // As addons.mozilla.org doesn’t accept file bigger than 5 Mb,
            // we had to split the thesaurus in two parts. And now we merge them.
            let _oData1 = JSON.parse(sJSONData1);
            let _oData2 = JSON.parse(sJSONData2);
            let _oData = { ..._oData1, ..._oData2 };
            // convert to Map
            this._dWord = helpers.objectToMap(_oData);
            this.bInit = true;
            //console.log(this._dWord);
        }
        catch (e) {
            console.error(e);
        }
    },

    getSyns: function (sWord) {
        // return list of synonyms of <sWord>
        if (!sWord) {
            return [];
        }
        if (this._dWord.has(sWord)) {
            return this._dWord.get(sWord);
        }
        if (sWord.slice(0,1).gl_isUpperCase()) {
            sWord = sWord.toLowerCase();
            if (this._dWord.has(sWord)) {
                return this._dWord.get(sWord);
            }
        }
        return [];
    }
};



// Initialization
if (!thesaurus.bInit && typeof(process) !== 'undefined') {
    // NodeJS
    thesaurus.init(helpers.loadFile(__dirname+"/thesaurus1_data.json"), helpers.loadFile(__dirname+"/thesaurus2_data.json"));
} else if (!thesaurus.bInit && typeof(browser) !== 'undefined') {
    // WebExtension Standard (but not in Worker)
    thesaurus.init(helpers.loadFile(browser.runtime.getURL("grammalecte/fr/thesaurus1_data.json")), helpers.loadFile(browser.runtime.getURL("grammalecte/fr/thesaurus2_data.json")));
} else if (!thesaurus.bInit && typeof(chrome) !== 'undefined') {
    // WebExtension Chrome (but not in Worker)
    thesaurus.init(helpers.loadFile(chrome.runtime.getURL("grammalecte/fr/thesaurus1_data.json")), helpers.loadFile(chrome.runtime.getURL("grammalecte/fr/thesaurus2_data.json")));
} else if (thesaurus.bInit){
    console.log("Module thesaurus déjà initialisé");
} else {
    //console.log("Module thesaurus non initialisé");
}


if (typeof(exports) !== 'undefined') {
    exports._dWord = thesaurus._dWord;
    exports.init = thesaurus.init;
    exports.getSyns = thesaurus.getSyns;
}
