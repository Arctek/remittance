"use strict";

/**
 * @param {!object} txReceipt, a transaction receipt.
 * @param {!object} txObject, a transaction object.
 * @returns {!object} BigNumber gasCost.
 */
module.exports = function calculateGasCost(txReceipt, txObject) {
    return txObject.gasPrice.times(txReceipt.receipt.gasUsed);
}