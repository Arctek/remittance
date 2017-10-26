'use strict';

const Ownable = artifacts.require("./Ownable.sol");

import { default as Promise } from 'bluebird';

if (typeof web3.eth.getBlockPromise !== "function") {
    Promise.promisifyAll(web3.eth, { suffix: "Promise" });
}

web3.eth.getTransactionReceiptMined = require("../test_util/getTransactionReceiptMined.js");
web3.eth.expectedPayableExceptionPromise = require("../test_util/expectedPayableExceptionPromise.js");
web3.eth.expectedExceptionPromise = require("../test_util/expectedExceptionPromise.js");
web3.eth.makeSureAreUnlocked = require("../test_util/makeSureAreUnlocked.js");
web3.eth.makeSureHasAtLeast = require("../test_util/makeSureHasAtLeast.js");
assert.topicContainsAddress = require("../test_util/topicContainsAddress.js");

contract('Ownable', accounts => {
    const gasToUse = 3000000;

    let owner, bob;

    before("should prepare accounts", function() {
        assert.isAtLeast(accounts.length, 2, "should have at least 2 accounts");
        owner = accounts[0];
        bob = accounts[1];
        return web3.eth.makeSureAreUnlocked([owner, bob]);
    });

    beforeEach(() => {
        return Ownable.new({ from: owner }).then(instance => contract = instance);
    });

    it('should have set initial owner properly', () => {
        return contract.owner({ from: owner } )
        .then(currentOwner => { 
            assert.strictEqual(currentOwner, owner, "the initial owner was not set") 
        });
    });

    it('should allow owner to set owner', () => {
        return contract.setOwner(bob, { from: owner }
        ).then(txObject => {
            assert.equal(txObject.logs.length, 1, "should have received 1 event");
            assert.strictEqual(txObject.logs[0].event, "LogSetOwner", "should have received LogSetOwner event");
            
            assert.strictEqual(
                txObject.logs[0].args.oldOwner,
                owner,
                "should be the initial owner");
            assert.strictEqual(
                txObject.logs[0].args.newOwner,
                bob,
                "should be the new owner");
            
            assert.equal(txObject.receipt.logs[0].topics.length, 3, "should have 3 topics");

            assert.topicContainsAddress(txObject.receipt.logs[0].topics[1], owner);
            assert.topicContainsAddress(txObject.receipt.logs[0].topics[2], bob);

            return contract.owner();
        })
        .then(newOwner => {
            assert.strictEqual(newOwner, bob, "the owner was not changed")
        });
    });

    it('should not allow non-owner to set owner', () => {
        return web3.eth.expectedExceptionPromise(() => 
            contract.setOwner(bob, { from: bob, gas: gasToUse }),
        gasToUse);
    });

    it('should not allow owner to set owner to itself', () => {
        return web3.eth.expectedExceptionPromise(() => 
            contract.setOwner(owner, { from: owner, gas: gasToUse }),
        gasToUse);
    });

});
