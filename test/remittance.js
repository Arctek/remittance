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
web3.eth.calculateGasCost = require("../test_util/calculateGasCost.js");
assert.topicContainsAddress = require("../test_util/topicContainsAddress.js");

contract('Remittance', accounts => {
    const gasToUse = 3000000;
    const escrowAmount = new web3.BigNumber(Math.floor(Math.random() * 100000) + 1);
    const escrowFee = escrowAmount.dividedBy(100).round();
    const newEscrowFee = escrowAmount.dividedBy(22).round();
    const deadlineBlock = new web3.BigNumber(Math.floor(Math.random() * 5) + 5);

    const zeroAddress = ("0x").padEnd(42, 0);
    const zeroBigNumber = new web3.BigNumber(0);

    const blankRemittance = [ zeroAddress, zeroAddress, zeroBigNumber, zeroBigNumber ];

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
        it('should have set escrow fee properly', async () => {
            let currentEscrowFee = await contract.escrowFee();
            
            assert.deepEqual(escrowFee, currentEscrowFee, "the initial escrow fee was not set") 
        });

        it('should have no commission', async () => {
            let commission = await contract.commission();
            
            assert.deepEqual(commission, zeroBigNumber, "the initial commission was an unexpected value") 
        });

        it('should not allow non-owner to set escrow fee', () => {
            return web3.eth.expectedExceptionPromise(() =>
                contract.setEscrowFee(newEscrowFee, { from: sender, gas: gasToUse }), gasToUse);
        });

        it('should allow owner to set escrow fee', async () => {
            let txObject = await contract.setEscrowFee(newEscrowFee, { from: owner });
            let currentEscrowFee = await contract.escrowFee();

            assertEventLogSetEscrowFee(txObject, owner, newEscrowFee);

            assert.deepEqual(newEscrowFee, currentEscrowFee, "the escrow fee was not set");
        });

        it('should not allow escrow recipient to be blank', () => {
            return web3.eth.expectedExceptionPromise(() =>
                contract.escrow(0, hashedPassword, 0, { from: sender, gas: gasToUse, value: escrowAmount }), gasToUse);
        });

        it('should not allow escrow recipient to be the sender', () => {
            return web3.eth.expectedExceptionPromise(() => 
                contract.escrow(sender, hashedPassword, 0, { from: sender, gas: gasToUse, value: escrowAmount }), gasToUse);
        });

        it('should not allow escrow hashed password to be blank', () => {
            return web3.eth.expectedExceptionPromise(() =>
                contract.escrow(recipient, 0, 0, { from: sender, gas: gasToUse, value: escrowAmount }), gasToUse);
        });

        it('should not allow escrow to accept a zero amount', () => {
            return web3.eth.expectedExceptionPromise(() =>
                contract.escrow(recipient, recipient, zeroBigNumber, { from: sender, gas: gasToUse, value: 0 }), gasToUse);
        });

        it('should allow escrow without deadline block', async () => {
            let expectedEscrowAmount = escrowAmount.minus(escrowFee);
            let txObject = await contract.escrow(recipient, hashedPassword, zeroBigNumber, { from: sender, gas: gasToUse, value: escrowAmount });
            let remittance = await contract.remittances(addressableHash);
            
            assertEventLogEscrow(txObject, sender, recipient, addressableHash, hashedPassword, zeroBigNumber, escrowAmount);

            assert.deepEqual(remittance, [ sender, recipient, expectedEscrowAmount, zeroBigNumber ], "remittance did not match expected parameters");
        });

        it('should allow escrow with deadline block', async () => {
            let expectedEscrowAmount = escrowAmount.minus(escrowFee);
            let txObject = await contract.escrow(recipient, hashedPassword, deadlineBlock, { from: sender, gas: gasToUse, value: escrowAmount });
            let expectedBlockNumber = deadlineBlock.plus(txObject.receipt.blockNumber);
            let remittance = await contract.remittances(addressableHash);
            
            assertEventLogEscrow(txObject, sender, recipient, addressableHash, hashedPassword, deadlineBlock, escrowAmount);

            assert.deepEqual(remittance, [ sender, recipient, expectedEscrowAmount, expectedBlockNumber ], "remittance did not match expected parameters");
        });

        it('should not allow pushing funds into an existing escrow', async () => {
            await contract.escrow(recipient, hashedPassword, deadlineBlock, { from: sender, gas: gasToUse, value: escrowAmount });

            await web3.eth.expectedExceptionPromise(() =>
                contract.escrow(recipient, hashedPassword, deadlineBlock, { from: sender, gas: gasToUse, value: escrowAmount }), gasToUse);
        });
    });

    describe("Paused contract actions", () => {
        beforeEach("should pause the contract", () => {
            return contract.setPaused(true, { from: owner });
        });

        it('should not allow escrow fee to be set on a paused contract', () => {
            return web3.eth.expectedExceptionPromise(() =>
                contract.setEscrowFee(newEscrowFee, { from: owner, gas: gasToUse }), gasToUse);
        });

        it('should not allow escrow on a paused contract', () => {
            return web3.eth.expectedExceptionPromise(() => 
                contract.escrow(recipient, hashedPassword, zeroBigNumber, { from: sender, gas: gasToUse, value: escrowAmount }), gasToUse);
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
            return web3.eth.expectedExceptionPromise(() =>
                contract.setEscrowFee(newEscrowFee, { from: owner, gas: gasToUse }), gasToUse);
        });

        it('should not allow escrow on a killed contract', () => {
            return web3.eth.expectedExceptionPromise(() =>
                contract.escrow(recipient, hashedPassword, zeroBigNumber, { from: sender, gas: gasToUse, value: escrowAmount }), gasToUse);
        });
    });

    describe("No deadline actions", () => {
        beforeEach("should put funds into escrow without a deadline set", () => {
            return contract.escrow(recipient, hashedPassword, zeroBigNumber, { from: sender, gas: gasToUse, value: escrowAmount })
                 .then(txObject => { assertEventLogEscrow(txObject, sender, recipient, addressableHash, hashedPassword, zeroBigNumber, escrowAmount); });
        });

        it('should not allow sender to claim when no deadline block has been set', () => {
            return web3.eth.expectedExceptionPromise(() => 
                contract.claim(recipient, hashedPassword, { from: sender, gas: gasToUse }), gasToUse);
        });
    });

    describe("Escrow contract actions", () => {
        beforeEach("should put funds into escrow with a deadline set", () => {
            return contract.escrow(recipient, hashedPassword, deadlineBlock, { from: sender, gas: gasToUse, value: escrowAmount })
                 .then(txObject => { assertEventLogEscrow(txObject, sender, recipient, addressableHash, hashedPassword, deadlineBlock, escrowAmount); });
        });

        it('should not allow remitt hashed password to be blank', () => {
            return web3.eth.expectedExceptionPromise(() =>
                contract.remitt(0, { from: recipient, gas: gasToUse }), gasToUse);
        });

        it('should not allow a third party to access a remittance using a correct hashed password', () => {
            return web3.eth.expectedExceptionPromise(() => 
                contract.remitt(hashedPassword, { from: thirdParty, gas: gasToUse }), gasToUse);
        });

        it('should not have a remittance for a third party', async () => {
            let thirdPartyAddressableHash = web3.sha3((thirdParty.slice(2)+hashedPassword.slice(2)).padStart(64, 0), { encoding: 'hex' });

            let remittance = await contract.remittances(thirdPartyAddressableHash);

            assert.deepEqual(remittance, blankRemittance, "remittance did not match expected parameters");
        });

        it('should allow a remittance', async () => {
            let recipientAccountBalance = await web3.eth.getBalancePromise(recipient);
            let remittance = await contract.remittances(addressableHash);
            let recipientContractBalance = new web3.BigNumber(remittance[2]);

            let txObject = await contract.remitt(hashedPassword, { from: recipient });
            let tx = await web3.eth.getTransaction(txObject.tx);

            let newRecipientAccountBalance = await web3.eth.getBalancePromise(recipient);
            let newRemittance = await contract.remittances(addressableHash);
            let newRecipientContractBalance = new web3.BigNumber(newRemittance[2]);

            let gasCost = web3.eth.calculateGasCost(txObject, tx);
            let expectedAccountBalance = recipientAccountBalance.plus(recipientContractBalance).minus(gasCost);

            assertEventLogRemitt(txObject, recipient, hashedPassword, recipientContractBalance);

            assert.deepEqual(expectedAccountBalance, newRecipientAccountBalance, "the remitted amount was incorrect");
            assert.deepEqual(newRemittance, blankRemittance, "remittance did not match expected parameters");
        });

        it('should not allow non-owner to withdraw commission', () => {
            return web3.eth.expectedExceptionPromise(() =>
                contract.withdrawCommission({ from: thirdParty, gas: gasToUse }), gasToUse);
        });

        it('should allow owner to withdraw commission', async () => {
            let ownerAccountBalance = await web3.eth.getBalancePromise(owner);
            let ownerContractCommission = await contract.commission();

            let txObject = await contract.withdrawCommission({ from: owner });
            let tx = await web3.eth.getTransaction(txObject.tx);

            let newOwnerAccountBalance = await web3.eth.getBalancePromise(owner);
            let newOwnerContractCommission = await contract.commission();

            let gasCost = web3.eth.calculateGasCost(txObject, tx);
            let expectedAccountBalance = ownerAccountBalance.plus(ownerContractCommission).minus(gasCost);

            assertEventLogWithdrawCommission(txObject, owner, ownerContractCommission);

            assert.deepEqual(expectedAccountBalance, newOwnerAccountBalance, "the withdrawn commission amount was incorrect");

            assert.deepEqual(newOwnerContractCommission, zeroBigNumber, "commission was not set back to zero");
        });

        it('should not allow sender to claim before the deadline block', () => {
            return web3.eth.expectedExceptionPromise(() => 
                contract.claim(recipient, hashedPassword, { from: sender, gas: gasToUse }), gasToUse);
        });

        it('should allow sender to claim after the deadline block', async () => {
            for (let i = 0; i < deadlineBlock; i++) {
                await contract.commission.sendTransaction({from: owner});
            }

            let senderAccountBalance = await web3.eth.getBalancePromise(sender);
            let remittance = await contract.remittances(addressableHash);
            let senderContractBalance = new web3.BigNumber(remittance[2]);

            let txObject = await contract.claim(recipient, hashedPassword, { from: sender });
            let tx = await web3.eth.getTransaction(txObject.tx);

            let newRecipientAccountBalance = await web3.eth.getBalancePromise(sender);
            let newRemittance = await contract.remittances(addressableHash);
            let newRecipientContractBalance = new web3.BigNumber(newRemittance[2]);

            let gasCost = web3.eth.calculateGasCost(txObject, tx);
            let expectedAccountBalance = senderAccountBalance.plus(senderContractBalance).minus(gasCost);

            assertEventLogClaim(txObject, sender, recipient, hashedPassword, senderContractBalance);

            assert.deepEqual(expectedAccountBalance, newRecipientAccountBalance, "the claimed amount was incorrect");
            assert.deepEqual(newRemittance, blankRemittance, "remittance did not match expected parameters");
        });

        describe("Paused contract actions", () => {
            beforeEach("should pause the contract", () => {
                return contract.setPaused(true, { from: owner });
            });

            it('should not allow remitt on a paused contract', () => {
                return web3.eth.expectedExceptionPromise(() =>
                    contract.remitt(hashedPassword, { from: recipient, gas: gasToUse }), gasToUse);
            });

            it('should not allow sender to claim after the deadline block on a paused contract', async () => {
                for (let i = 0; i < deadlineBlock; i++) {
                    await contract.commission.sendTransaction({from: owner});
                }

                await web3.eth.expectedExceptionPromise(() =>
                    contract.claim(recipient, hashedPassword, { from: sender }), gasToUse);
            });

            it('should not allow withdraw commission on a paused contract', () => {
                return web3.eth.expectedExceptionPromise(() =>
                    contract.withdrawCommission({ from: owner, gas: gasToUse }), gasToUse);
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
                return web3.eth.expectedExceptionPromise(() =>
                    contract.remitt(hashedPassword, { from: recipient, gas: gasToUse }), gasToUse);
            });

            it('should not allow sender to claim after the deadline block on a killed contract', async () => {
                for (let i = 0; i < deadlineBlock; i++) {
                    await contract.commission.sendTransaction({from: owner});
                }

                await web3.eth.expectedExceptionPromise(() =>
                    contract.claim(recipient, hashedPassword, { from: sender }), gasToUse);
            });

            it('should not allow withdraw commission on a killed contract', () => {
                return web3.eth.expectedExceptionPromise(() =>
                    contract.withdrawCommission({ from: owner, gas: gasToUse }), gasToUse);
            });
        });
    });
    
});

function assertEventLogSetEscrowFee(txObject, who, escrowFee) {
    assert.strictEqual(txObject.logs.length, 1, "should have received 1 event");
    assert.strictEqual(txObject.logs[0].event, "LogSetEscrowFee", "should have received LogSetEscrowFee event");

    assert.strictEqual(
        txObject.logs[0].args.who,
        who,
        "should be owner");
    assert.deepEqual(
        txObject.logs[0].args.escrowFee,
        escrowFee,
        "should be escrow fee");

    assert.strictEqual(txObject.receipt.logs[0].topics.length, 2, "should have 2 topics");

    assert.topicContainsAddress(txObject.receipt.logs[0].topics[1], who);
}

function assertEventLogEscrow(txObject, sender, recipient, addressableHash, hashedPassword, deadlineBlock, amount) {
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
    assert.deepEqual(
        txObject.logs[0].args.deadlineBlock,
        deadlineBlock,
        "should be deadline block");
    assert.deepEqual(
        txObject.logs[0].args.amount,
        amount,
        "should be amount");
    
    assert.strictEqual(txObject.receipt.logs[0].topics.length, 4, "should have 4 topics");

    assert.topicContainsAddress(txObject.receipt.logs[0].topics[1], sender);
    assert.topicContainsAddress(txObject.receipt.logs[0].topics[2], recipient);
    assert.strictEqual(txObject.receipt.logs[0].topics[3], addressableHash, "topic should match address hash");
}

function assertEventLogRemitt(txObject, recipient, hashedPassword, amount) {
    assert.strictEqual(txObject.logs.length, 1, "should have received 1 event");
    assert.strictEqual(txObject.logs[0].event, "LogRemitt", "should have received LogRemitt event");

    assert.strictEqual(
        txObject.logs[0].args.recipient,
        recipient,
        "should be recipient");
    assert.strictEqual(
        txObject.logs[0].args.hashedPassword,
        hashedPassword,
        "should be hashed password");
    assert.deepEqual(
        txObject.logs[0].args.amount,
        amount,
        "should be amount");
    
    assert.strictEqual(txObject.receipt.logs[0].topics.length, 2, "should have 2 topics");

    assert.topicContainsAddress(txObject.receipt.logs[0].topics[1], recipient);
}

function assertEventLogClaim(txObject, sender, recipient, hashedPassword, amount) {
    assert.strictEqual(txObject.logs.length, 1, "should have received 1 event");
    assert.strictEqual(txObject.logs[0].event, "LogClaim", "should have received LogClaim event");

    assert.strictEqual(
        txObject.logs[0].args.sender,
        sender,
        "should be sender");
    assert.strictEqual(
        txObject.logs[0].args.recipient,
        recipient,
        "should be recipient");
    assert.strictEqual(
        txObject.logs[0].args.hashedPassword,
        hashedPassword,
        "should be hashed password");
    assert.deepEqual(
        txObject.logs[0].args.amount,
        amount,
        "should be amount");
    
    assert.strictEqual(txObject.receipt.logs[0].topics.length, 3, "should have 2 topics");

    assert.topicContainsAddress(txObject.receipt.logs[0].topics[1], sender);
    assert.topicContainsAddress(txObject.receipt.logs[0].topics[2], recipient);
}

function assertEventLogWithdrawCommission(txObject, who, commissionBalance) {
    assert.strictEqual(txObject.logs.length, 1, "should have received 1 event");
    assert.strictEqual(txObject.logs[0].event, "LogWithdrawCommission", "should have received LogWithdrawCommission event");

    assert.strictEqual(
        txObject.logs[0].args.who,
        who,
        "should be owner");
    assert.deepEqual(
        txObject.logs[0].args.commissionBalance,
        commissionBalance,
        "should be commission balance");
    
    assert.strictEqual(txObject.receipt.logs[0].topics.length, 2, "should have 2 topics");

    assert.topicContainsAddress(txObject.receipt.logs[0].topics[1], who);
}