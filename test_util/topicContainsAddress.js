"use strict";

/**
 * @param {!string} topic. Topic from event log.
 * @param {!string} address. Address to match.
 */
module.exports = function assertTopicContainsAddress(topic, address) {
    this.strictEqual(address.length, 42, "should be 42 characters long");
    this.strictEqual(topic.length, 66, "should be 64 characters long");

    address = "0x" + address.substring(2).padStart(64, "0");

    this.strictEqual(topic, address, "topic should match address");
}