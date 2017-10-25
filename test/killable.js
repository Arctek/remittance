'use strict';

const Killable = artifacts.require("./Killable.sol");

import { default as Promise } from 'bluebird';

if (typeof web3.eth.getBlockPromise !== "function") {
    Promise.promisifyAll(web3.eth, { suffix: "Promise" });
}

web3.eth.getTransactionReceiptMined = require("../test_util/getTransactionReceiptMined.js");
web3.eth.expectedPayableExceptionPromise = require("../test_util/expectedPayableExceptionPromise.js");
web3.eth.expectedExceptionPromise = require("../test_util/expectedExceptionPromise.js");
web3.eth.makeSureAreUnlocked = require("../test_util/makeSureAreUnlocked.js");
web3.eth.makeSureHasAtLeast = require("../test_util/makeSureHasAtLeast.js");

contract('Killable', accounts => {
    const gasToUse = 3000000;
    let owner, bob;

    before("should prepare accounts", function() {
        assert.isAtLeast(accounts.length, 2, "should have at least 2 accounts");
        owner = accounts[0];
        bob = accounts[1];
        return web3.eth.makeSureAreUnlocked([owner, bob]);
    });

    beforeEach(() => {
        return Killable.new({ from: owner }).then(instance => contract = instance);
    });

    it('should be initialized as unkilled', () => {
        return contract.killed().then(isKilled => { assert.strictEqual(isKilled, false, "killed"); });
    });

    it('should allow not owner to kill an unpaused contract', () => {
        return web3.eth.expectedExceptionPromise(() => {
            return contract.kill({ from: owner, gas: gasToUse });
        }, gasToUse);
    });

    describe("Paused contract", () => {
        beforeEach("should pause the contract", () => {
            return contract.setPaused(true, { from: owner });
        });

        it('should not allow non-owner to kill the contract', () => {
            return web3.eth.expectedExceptionPromise(() => {
                return contract.kill({ from: bob, gas: gasToUse });
            }, gasToUse);
        });

        it('should not allow the owner to emergency withdraw on a unkilled contract', () => {
            return web3.eth.expectedExceptionPromise(() => {
                return contract.emergencyWithdrawal({ from: owner, gas: gasToUse });
            }, gasToUse);
        });

        it('should allow owner to kill the contract', () => {
                return contract.kill({ from: owner }
            ).then(txObject => {
                asertEventLogKill(txObject, owner);

                return contract.killed()
            }).then(newKilled => {
                assert.strictEqual(newKilled, true, "the contract was not killed");
            });
        });
    });

    describe("Paused and killed contract", () => {
        beforeEach("should pause the contract", () => {
            return contract.setPaused(true, { from: owner });
        });

        beforeEach("should kill the contract", () => {
            return contract.kill({ from: owner })
                .then(txObject => { asertEventLogKill(txObject, owner); });
        });

        it('should not allow non-owner to emergency withdraw a killed contract', () => {
            return web3.eth.expectedExceptionPromise(() => {
                return contract.emergencyWithdrawal({ from: bob, gas: gasToUse });
            }, gasToUse);
        });

        it('should allow owner to emergency withdraw a killed contract', () => {
                return contract.emergencyWithdrawal({ from: owner }
            )
            .then(txObject => {
                asertEventLogWithdraw(txObject, owner);

                return contract.isWithdrawn();
            })
            .then(isWithdrawn => {
                assert.strictEqual(isWithdrawn, true, "the owner could not emergency withdraw");
            });
        });

        it('should not allow owner to emergency withdraw twice', () => {
            return contract.emergencyWithdrawal({ from: owner }
            )
            .then(txObject => {
                asertEventLogWithdraw(txObject, owner);
                
                return web3.eth.expectedExceptionPromise(() => {
                    return contract.emergencyWithdrawal({ from: owner, gas: gasToUse });
                }, gasToUse);
            });
        });
    });

});

function asertEventLogKill(txObject, who) {
    assert.equal(txObject.logs.length, 1, "should have received 1 event");
                
    assert.strictEqual(
        txObject.logs[0].args.who,
        who,
        "should be the owner");
    
    assert.equal(txObject.receipt.logs[0].topics.length, 2, "should have 2 topics");
}

function asertEventLogWithdraw(txObject, who) {
    assert.equal(txObject.logs.length, 1, "should have received 1 event");
                
    assert.strictEqual(
        txObject.logs[0].args.who,
        who,
        "should be the owner");
    
    assert.equal(txObject.receipt.logs[0].topics.length, 2, "should have 2 topics");
}