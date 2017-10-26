'use strict';

const Killable = artifacts.require("./Killable.sol");

import { default as Promise } from 'bluebird';

if (typeof web3.eth.getBlockPromise !== "function") {
    Promise.promisifyAll(web3.eth, { suffix: "Promise" });
}

const ethJsUtil = require('../node_modules/ethereumjs-util/');

web3.eth.getTransactionReceiptMined = require("../test_util/getTransactionReceiptMined.js");
web3.eth.expectedPayableExceptionPromise = require("../test_util/expectedPayableExceptionPromise.js");
web3.eth.expectedExceptionPromise = require("../test_util/expectedExceptionPromise.js");
web3.eth.makeSureAreUnlocked = require("../test_util/makeSureAreUnlocked.js");
web3.eth.makeSureHasAtLeast = require("../test_util/makeSureHasAtLeast.js");

contract('Killable', accounts => {
    const gasToUse = 3000000;
    const existingAddressBalance = new web3.BigNumber((Math.floor(Math.random() * 100000) + 1) * 2);
    let owner, bob, owner2;

    before("should prepare accounts", function() {
        assert.isAtLeast(accounts.length, 3, "should have at least 3 accounts");
        owner = accounts[0];
        bob = accounts[1];
        owner2 = accounts[2];

        return web3.eth.makeSureAreUnlocked([owner, bob, owner2])
            .then(() => {
                return web3.eth.getCoinbasePromise();
            })
            .then(coinbaseAccount => {
                assert.notEqual(coinbaseAccount, owner2, "owner2 should not be coinbase for testing");
            })
            .then(() => web3.eth.makeSureHasAtLeast(owner, [bob, owner2], web3.toWei(2)))
            .then(txObject => web3.eth.getTransactionReceiptMined(txObject))
            .then(() => web3.eth.makeSureHasAtLeast(owner2, [bob, owner], web3.toWei(2)))
            .then(txObject => web3.eth.getTransactionReceiptMined(txObject));
    });

    describe("Contract and kill actions", () => {
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

    });

    describe("Withdraw actions", () => {
        // There is no way to send ETH to the Killable on its own contract, so lets create the contract at an address than has some.
        // Then we can check it actually sends ether back when it is emergency withdrawn.
        // Use owner2 here otherwise mining in geth will change the account balance in between what we expect
        beforeEach("should create a contract on an address that has a balance", () => {
            let futureAddress;

            return web3.eth.getTransactionCountPromise(owner2)
                .then(currentNonce => {
                    futureAddress = ethJsUtil.bufferToHex(ethJsUtil.generateAddress(owner2, currentNonce + 1));
                    return web3.eth.sendTransactionPromise({
                        from: owner2,
                        to: futureAddress,
                        value: existingAddressBalance
                    });
                })
                .then(tx => {
                    return web3.eth.getTransactionReceiptMined(tx);
                })
                .then(receipt => Killable.new({ from: owner2 }))
                .then(instance => {
                    contract = instance;

                    return web3.eth.getBalancePromise(contract.address);
                })
                .then(balance => {
                    assert.strictEqual(balance.equals(existingAddressBalance), true, "should already have a balance");
                });
        });

        beforeEach("should pause the contract", () => {
            return contract.setPaused(true, { from: owner2 });
        });

        beforeEach("should kill the contract", () => {
            return contract.kill({ from: owner2 })
                .then(txObject => { asertEventLogKill(txObject, owner2); });
        });

        it('should not allow non-owner to emergency withdraw a killed contract', () => {
            return web3.eth.expectedExceptionPromise(() => {
                return contract.emergencyWithdrawal({ from: bob, gas: gasToUse });
            }, gasToUse);
        });

        it('should allow owner to emergency withdraw a killed contract', () => {
                let ownerAccountBalance;
                let contractInitialBalance;
                let gasCost;
                let gasUsed;
                let gasPrice;

                return web3.eth.getBalancePromise(owner2)
            .then(accountBalance => {
                ownerAccountBalance = accountBalance;

                return web3.eth.getBalancePromise(contract.address);
            }).then(contractBalance => {
                contractInitialBalance = contractBalance;

                return contract.emergencyWithdrawal({ from: owner2 });
            })
            .then(txObject => {
                gasUsed = txObject.receipt.gasUsed;

                asertEventLogEmergencyWithdrawal(txObject, owner2);

                return web3.eth.getTransaction(txObject.tx);
            })
            .then(tx => {
                gasPrice = tx.gasPrice;
                gasCost = tx.gasPrice.times(gasUsed);

                return web3.eth.getBalancePromise(owner2);
            })
            .then(accountBalance => {
                let expectedAccountBalance = ownerAccountBalance.plus(contractInitialBalance).minus(gasCost);
                
                assert.strictEqual(expectedAccountBalance.equals(accountBalance), true, "the emergency withdrawn amount was incorrect");

                return web3.eth.getBalancePromise(contract.address);
            })
            .then(contractBalance => {
                assert.strictEqual(contractBalance.equals(0), true, "contract balance should be zero");

                return contract.isWithdrawn();
            })
            .then(isWithdrawn => {
                assert.strictEqual(isWithdrawn, true, "the is withdrawn state was not set correclty");
            });
        });

        it('should not allow owner to emergency withdraw twice', () => {
            return contract.emergencyWithdrawal({ from: owner2 }
            )
            .then(txObject => {
                asertEventLogEmergencyWithdrawal(txObject, owner2);
                
                return web3.eth.expectedExceptionPromise(() => {
                    return contract.emergencyWithdrawal({ from: owner2, gas: gasToUse });
                }, gasToUse);
            });
        });

    });

});

function asertEventLogKill(txObject, who) {
    assert.equal(txObject.logs.length, 1, "should have received 1 event");
    assert.strictEqual(txObject.logs[0].event, "LogKill", "should have received LogKill event");
                
    assert.strictEqual(
        txObject.logs[0].args.who,
        who,
        "should be the owner");
    
    assert.strictEqual(txObject.receipt.logs[0].topics.length, 2, "should have 2 topics");

    assertTopicContainsAddress(txObject.receipt.logs[0].topics[1], who);
}

function asertEventLogEmergencyWithdrawal(txObject, who) {
    assert.equal(txObject.logs.length, 1, "should have received 1 event");
    assert.strictEqual(txObject.logs[0].event, "LogEmergencyWithdrawal", "should have received LogEmergencyWithdrawal event");
                
    assert.strictEqual(
        txObject.logs[0].args.who,
        who,
        "should be the owner");
    
    assert.strictEqual(txObject.receipt.logs[0].topics.length, 2, "should have 2 topics");

    assertTopicContainsAddress(txObject.receipt.logs[0].topics[1], who);
}

function assertTopicContainsAddress(topic, address) {
    assert.strictEqual(address.length, 42, "should be 42 characters long");
    assert.strictEqual(topic.length, 66, "should be 64 characters long");

    address = "0x" + address.substring(2).padStart(64, "0");

    assert.strictEqual(topic, address, "topic should match address");
}