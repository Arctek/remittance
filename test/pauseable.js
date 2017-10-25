'use strict';

const Pauseable = artifacts.require("./Pauseable.sol");

import { default as Promise } from 'bluebird';

if (typeof web3.eth.getBlockPromise !== "function") {
    Promise.promisifyAll(web3.eth, { suffix: "Promise" });
}

web3.eth.getTransactionReceiptMined = require("../test_util/getTransactionReceiptMined.js");
web3.eth.expectedPayableExceptionPromise = require("../test_util/expectedPayableExceptionPromise.js");
web3.eth.expectedExceptionPromise = require("../test_util/expectedExceptionPromise.js");
web3.eth.makeSureAreUnlocked = require("../test_util/makeSureAreUnlocked.js");
web3.eth.makeSureHasAtLeast = require("../test_util/makeSureHasAtLeast.js");

contract('Pauseable', accounts => {
    const gasToUse = 3000000;
    let owner, bob;

    before("should prepare accounts", function() {
        assert.isAtLeast(accounts.length, 2, "should have at least 2 accounts");
        owner = accounts[0];
        bob = accounts[1];
        return web3.eth.makeSureAreUnlocked([owner, bob]);
    });

    beforeEach(() => {
        return Pauseable.new({ from: owner }).then(instance => contract = instance);
    });

    it('should be initialized as unpaused', () => {
        return contract.paused().then(isPaused => { assert.strictEqual(isPaused, false, "paused was initialized incorrectly");
        });
    });

    it('should not allow non-owner to pause', () => {
        return web3.eth.expectedExceptionPromise(() => {
            return contract.setPaused(true, { from: bob, gas: gasToUse });
        }, gasToUse);
    });

    it('should allow owner to pause', () => {
            return contract.setPaused(true, { from: owner }
        ).then(txObject => {
            asertEventLogPause(txObject, owner, true);

            return contract.paused();
        })
        .then(isPaused => {
            assert.strictEqual(isPaused, true, "paused was not changed");
        });
    });

    it('should not allow owner to change paused to the same value', () => {
            return contract.setPaused(true, { from: owner }
        ).then(() => {
            return web3.eth.expectedExceptionPromise(() => {
                return contract.setPaused(true, { from: owner, gas: gasToUse });
            }, gasToUse);
        });
    });

    it('should allow owner to unpause', () => {
            return contract.setPaused(true, { from: owner }
        ).then(txObject => {
            asertEventLogPause(txObject, owner, true);

            return contract.setPaused(false, { from: owner });
        }).then(txObject => {
            asertEventLogPause(txObject, owner, false);

            return contract.paused();
        })
        .then(isPaused => {
            assert.strictEqual(isPaused, false, "paused was not changed");
        });
    });
});

function asertEventLogPause(txObject, who, paused) {
    assert.equal(txObject.logs.length, 1, "should have received 1 event");
            
    assert.strictEqual(
        txObject.logs[0].args.who,
        who,
        "should be the owner");
    assert.strictEqual(
        txObject.logs[0].args.paused,
        paused,
        "should be the new paused value");
    // who and paused should be indexed
    assert.equal(txObject.receipt.logs[0].topics.length, 3, "should have 3 topics");
}