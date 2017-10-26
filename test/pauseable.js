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
            asertEventLogSetPause(txObject, owner, true);

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
            asertEventLogSetPause(txObject, owner, true);

            return contract.setPaused(false, { from: owner });
        }).then(txObject => {
            asertEventLogSetPause(txObject, owner, false);

            return contract.paused();
        })
        .then(isPaused => {
            assert.strictEqual(isPaused, false, "paused was not changed");
        });
    });
});

function asertEventLogSetPause(txObject, who, paused) {
    assert.equal(txObject.logs.length, 1, "should have received 1 event");
    assert.strictEqual(txObject.logs[0].event, "LogSetPaused", "should have received LogSetPaused event");
            
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

    assertTopicContainsAddress(txObject.receipt.logs[0].topics[1], who);
    assertTopicContainsBoolean(txObject.receipt.logs[0].topics[2], paused);

}

function assertTopicContainsAddress(topic, address) {
    assert.strictEqual(address.length, 42, "should be 42 characters long");
    assert.strictEqual(topic.length, 66, "should be 64 characters long");

    address = "0x" + address.substring(2).padStart(64, "0");

    assert.strictEqual(topic, address, "topic should match address");
}

function assertTopicContainsBoolean(topic, boolToCheck) {
    assert.strictEqual(topic.length, 66, "should be 64 characters long");

    assert.strictEqual(boolToCheck === true || boolToCheck === false, true, "not a boolean");

    if (boolToCheck === true) {
        assert.strictEqual(topic, "0x0000000000000000000000000000000000000000000000000000000000000001", "topic does not match true");
    }
    else {
        assert.strictEqual(topic, "0x0000000000000000000000000000000000000000000000000000000000000000", "topic does not match false");
    }

}