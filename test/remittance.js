'use strict';

const Remittance = artifacts.require("./Remittance.sol");

import { default as Promise } from 'bluebird';
import sha3 from 'solidity-sha3';

if (typeof web3.eth.getBlockPromise !== "function") {
    Promise.promisifyAll(web3.eth, { suffix: "Promise" });
}

web3.eth.getTransactionReceiptMined = require("../test_util/getTransactionReceiptMined.js");
web3.eth.expectedPayableExceptionPromise = require("../test_util/expectedPayableExceptionPromise.js");
web3.eth.expectedExceptionPromise = require("../test_util/expectedExceptionPromise.js");
web3.eth.makeSureAreUnlocked = require("../test_util/makeSureAreUnlocked.js");
web3.eth.makeSureHasAtLeast = require("../test_util/makeSureHasAtLeast.js");

contract('Remittance', accounts => {
    const gasToUse = 3000000;
    const escrowAmount = new web3.BigNumber(Math.floor(Math.random() * 100000) + 1);
    const escrowFee = escrowAmount.dividedBy(100).round();
    const newEscrowFee = escrowAmount.dividedBy(22).round();
    const deadlineBlock = new web3.BigNumber(Math.floor(Math.random() * 5) + 1);

    let owner, sender, recipient, thirdParty, addressableHash;

    const password = Math.random().toString(36).slice(2); // alice should give this to carol
    const hashedPassword = web3.sha3(password); // contract should only ever see this

    before("should prepare accounts", () => {
        assert.isAtLeast(accounts.length, 4, "should have at least 4 accounts");
        owner = accounts[0];
        sender = accounts[1];
        recipient = accounts[2];
        thirdParty = accounts[3];

        addressableHash = web3.sha3((recipient.slice(2)+hashedPassword.slice(2)).padStart(64, 0), { encoding: 'hex' });

        return web3.eth.makeSureAreUnlocked([owner, sender, recipient])
            .then(() => web3.eth.makeSureHasAtLeast(owner, [sender, recipient], escrowAmount.times(10)))
            .then(txObject => web3.eth.getTransactionReceiptMined(txObject));
    });

    beforeEach(() => {
        return Remittance.new(escrowFee, { from: owner }).then(instance => contract = instance);
    });

    describe("Main contract actions", () => {
        it('should have set escrow fee properly', () => {
                return contract.escrowFee()
            .then(currentEscrowFee => { 
                assert.strictEqual(escrowFee.equals(currentEscrowFee), true, "the initial escrow fee was not set") 
            });
        });

        it('should not allow non-owner to set escrow fee', () => {
            return web3.eth.expectedExceptionPromise(() => {
                return contract.setEscrowFee(newEscrowFee, { from: sender, gas: gasToUse });
            }, gasToUse);
        });

        it('should allow owner to set escrow fee', () => {
                return contract.setEscrowFee(newEscrowFee, { from: owner }
            )
            .then(() => {
                return contract.escrowFee();
            })
            .then(currentEscrowFee => { 
                assert.strictEqual(newEscrowFee.equals(currentEscrowFee), true, "the escrow fee was not set");
            });
        });

        it('should not allow escrow recipient to be blank', () => {
            return web3.eth.expectedExceptionPromise(() => {
                return contract.escrow(0, hashedPassword, 0, { from: sender, gas: gasToUse, value: escrowAmount });
            }, gasToUse);
        });

        it('should not allow escrow recipient to be the sender', () => {
            return web3.eth.expectedExceptionPromise(() => {
                return contract.escrow(sender, hashedPassword, 0, { from: sender, gas: gasToUse, value: escrowAmount });
            }, gasToUse);
        });

        it('should not allow escrow hashed password to be blank', () => {
            return web3.eth.expectedExceptionPromise(() => {
                return contract.escrow(recipient, 0, 0, { from: sender, gas: gasToUse, value: escrowAmount });
            }, gasToUse);
        });

        it('should not allow escrow to accept a zero amount', () => {
            return web3.eth.expectedExceptionPromise(() => {
                return contract.escrow(recipient, recipient, 0, { from: sender, gas: gasToUse, value: 0 });
            }, gasToUse);
        });

        it('should allow escrow without deadline block', () => {
                let expectedEscrowAmount = escrowAmount.minus(escrowFee);

                return contract.escrow(recipient, hashedPassword, 0, { from: sender, gas: gasToUse, value: escrowAmount }
            )
            .then(txObject => {
                asertEventLogEscrow(txObject, sender, recipient, addressableHash, hashedPassword, 0, escrowAmount);

                return contract.remittances(addressableHash);
            })
            .then(remittance => {  
                assert.deepEqual(remittance, [ sender, recipient, expectedEscrowAmount, (new web3.BigNumber(0)) ], "remittance did not match expected parameters");
            });
        });

        it('should allow escrow with deadline block', () => {
                let expectedEscrowAmount = escrowAmount.minus(escrowFee);
                let expectedBlockNumber;

                return contract.escrow(recipient, hashedPassword, deadlineBlock, { from: sender, gas: gasToUse, value: escrowAmount }
            )
            .then(txObject => {
                expectedBlockNumber = deadlineBlock.plus(txObject.receipt.blockNumber);

                asertEventLogEscrow(txObject, sender, recipient, addressableHash, hashedPassword, deadlineBlock, escrowAmount);

                return contract.remittances(addressableHash);
            })
            .then(remittance => {  
                assert.deepEqual(remittance, [ sender, recipient, expectedEscrowAmount, expectedBlockNumber ], "remittance did not match expected parameters");
            });
        });

        it('should allow pushing funds into an existing escrow', () => {
                let expectedEscrowAmount = escrowAmount.times(2).minus(escrowFee.times(2));

                return contract.escrow(recipient, hashedPassword, 0, { from: sender, gas: gasToUse, value: escrowAmount }
            )
            .then(() => {
                 return contract.escrow(recipient, hashedPassword, 0, { from: sender, gas: gasToUse, value: escrowAmount });
            })
            .then(txObject => {
                asertEventLogEscrow(txObject, sender, recipient, addressableHash, hashedPassword, 0, escrowAmount);

                return contract.remittances(addressableHash);
            })
            .then(remittance => {  
                assert.deepEqual(remittance, [ sender, recipient, expectedEscrowAmount, (new web3.BigNumber(0)) ], "remittance did not match expected parameters");
            });
        });
    });

    describe("Paused contract actions", () => {
        beforeEach("should pause the contract", () => {
            return contract.setPaused(true, { from: owner });
        });

        it('should not allow escrow fee to be set on a paused contract', () => {
            return web3.eth.expectedExceptionPromise(() => {
                return contract.setEscrowFee(newEscrowFee, { from: owner, gas: gasToUse });
            }, gasToUse);
        });

        it('should not allow escrow on a paused contract', () => {
            return web3.eth.expectedExceptionPromise(() => {
                return contract.escrow(recipient, hashedPassword, 0, { from: sender, gas: gasToUse, value: escrowAmount });
            }, gasToUse);
        });
    });

    describe("Killed contract actions", () => {
        beforeEach("should pause the contract", () => {
            return contract.setPaused(true, { from: owner });
        });

        beforeEach("should kill the contract", () => {
            return contract.kill({ from: owner });
        });

        it('should not allow escrow fee to be set on a killed contract', () => {
            return web3.eth.expectedExceptionPromise(() => {
                return contract.setEscrowFee(newEscrowFee, { from: owner, gas: gasToUse });
            }, gasToUse);
        });

        it('should not allow escrow on a killed contract', () => {
            return web3.eth.expectedExceptionPromise(() => {
                return contract.escrow(recipient, hashedPassword, 0, { from: sender, gas: gasToUse, value: escrowAmount });
            }, gasToUse);
        });
    });

    describe("Escrow contract actions", () => {
        beforeEach("should put funds into escrow with a deadline set", () => {
            return contract.escrow(recipient, hashedPassword, deadlineBlock, { from: sender, gas: gasToUse, value: escrowAmount });
        });

        it('should not allow remitt hashed password to be blank', () => {
            return web3.eth.expectedExceptionPromise(() => {
                return contract.remitt(0, { from: recipient, gas: gasToUse });
            }, gasToUse);
        });

        it('should not allow a third party to access a remittance using a correct hashed password', () => {
            return web3.eth.expectedExceptionPromise(() => {
                return contract.remitt(hashedPassword, { from: thirdParty, gas: gasToUse });
            }, gasToUse);
        });

        describe("Paused contract actions", () => {
            beforeEach("should pause the contract", () => {
                return contract.setPaused(true, { from: owner });
            });

            it('should not allow remitt on a paused contract', () => {
                return web3.eth.expectedExceptionPromise(() => {
                    return contract.remitt(hashedPassword, { from: recipient, gas: gasToUse });
                }, gasToUse);
            });

        });

        describe("Killed contract actions", () => {
            beforeEach("should pause the contract", () => {
                return contract.setPaused(true, { from: owner });
            });

            beforeEach("should kill the contract", () => {
                return contract.kill({ from: owner });
            });

            it('should not allow remitt on a killed contract', () => {
                return web3.eth.expectedExceptionPromise(() => {
                    return contract.remitt(hashedPassword, { from: recipient, gas: gasToUse });
                }, gasToUse);
            });
        });
    });
    
});

function asertEventLogEscrow(txObject, sender, recipient, addressableHash, hashedPassword, deadlineBlock, amount) {
    assert.strictEqual(txObject.logs.length, 1, "should have received 1 event");
    assert.strictEqual(txObject.logs[0].event, "LogEscrow", "should have received LogRemitt event");

    assert.strictEqual(
        txObject.logs[0].args.sender,
        sender,
        "should be sender");
    assert.strictEqual(
        txObject.logs[0].args.recipient,
        recipient,
        "should be recipient");
    assert.strictEqual(
        txObject.logs[0].args.addressableHash,
        addressableHash,
        "should be addressable hash");
    assert.strictEqual(
        txObject.logs[0].args.hashedPassword,
        hashedPassword,
        "should be hashed password");
    assert.strictEqual(
        txObject.logs[0].args.deadlineBlock.equals(deadlineBlock),
        true,
        "should be deadline block");
    assert.strictEqual(
        txObject.logs[0].args.amount.equals(amount),
        true,
        "should be amount");
    
    assert.strictEqual(txObject.receipt.logs[0].topics.length, 4, "should have 4 topics");

    assertTopicContainsAddress(txObject.receipt.logs[0].topics[1], sender);
    assertTopicContainsAddress(txObject.receipt.logs[0].topics[2], recipient);
    assert.strictEqual(txObject.receipt.logs[0].topics[3], addressableHash, "topic should match address hash");
}

function assertTopicContainsAddress(topic, address) {
    assert.strictEqual(address.length, 42, "should be 42 characters long");
    assert.strictEqual(topic.length, 66, "should be 64 characters long");

    address = "0x" + address.substring(2).padStart(64, "0");

    assert.strictEqual(topic, address, "topic should match address");
}