"use strict";

/**
 * @param {!string} topic. Topic from event log.
 * @param {!boolean} boolToCheck. Boolean to match.
 */
module.exports = function topicContainsBoolean(topic, boolToCheck) {
    assert.strictEqual(topic.length, 66, "should be 64 characters long");

    assert.strictEqual(boolToCheck === true || boolToCheck === false, true, "not a boolean");

    if (boolToCheck === true) {
        assert.strictEqual(topic, "0x0000000000000000000000000000000000000000000000000000000000000001", "topic does not match true");
    }
    else {
        assert.strictEqual(topic, "0x0000000000000000000000000000000000000000000000000000000000000000", "topic does not match false");
    }

}