pragma solidity 0.4.15;

import "./Killable.sol";

contract Remittance is Killable{
    struct RemittanceStruct {
        address sender;
        address recipient;
        uint balance;
        uint deadlineBlock;
    }

    mapping (bytes32 => RemittanceStruct) remmittances;
    uint escrowFee;
    uint commission;

    event LogEscrow(address indexed sender, address indexed recipient, bytes32 hashedPassword, uint deadlineBlock);
    event LogRemitt(address indexed recipient, bytes32 hashedPassword, uint balance);
    event LogClaim(address indexed sender, address indexed recipient, bytes32 hashedPassword, uint balance);
    event LogWithdrawCommission(address indexed who, uint commissionBalance);

    modifier hashedPasswordNotBlank(bytes32 hashedPassword){
        require(hashedPassword != 0);
        _;
    }

    modifier validRecipient(address recipient){
        require(recipient != address(0));
        require(recipient != msg.sender);
        _;
    }

    function Remittance(uint contractEscrowFee){
        escrowFee = contractEscrowFee;
    }

    function escrow(address recipient, bytes32 hashedPassword, uint deadlineBlock)
        public
        isNotPaused
        isNotKilled
        validRecipient(recipient)
        hashedPasswordNotBlank(hashedPassword)
        payable
        returns(bool success)
    {
        require(toBytes(recipient) != hashedPassword);
        require(msg.value > 0);

        bytes32 addressableHash = keccak256(recipient, hashedPassword);

        commission = commission + escrowFee;
        uint remmittanceBalance = msg.value - escrowFee;

        remmittances[addressableHash].sender = msg.sender;
        remmittances[addressableHash].recipient = recipient;
        remmittances[addressableHash].balance = remmittanceBalance;

        if (deadlineBlock > 0) {
            remmittances[addressableHash].deadlineBlock = block.number + deadlineBlock;
        }

        LogEscrow(msg.sender, recipient, hashedPassword, deadlineBlock);

        return true;
    }

    function remitt(bytes32 hashedPassword) 
        public
        isNotPaused
        isNotKilled
        hashedPasswordNotBlank(hashedPassword)
        returns(bool success)
    {
        bytes32 addressableHash = keccak256(msg.sender, hashedPassword);

        require(remmittances[addressableHash].recipient == msg.sender);
        require(remmittances[addressableHash].balance > 0);

        uint withdrawBalance = remmittances[addressableHash].balance;
        remmittances[addressableHash].balance = 0;

        msg.sender.transfer(withdrawBalance);

        LogRemitt(msg.sender, hashedPassword, withdrawBalance);

        return true;
    }

    function claim(address recipient, bytes32 hashedPassword)
        public
        isNotPaused
        isNotKilled
        validRecipient(recipient)
        hashedPasswordNotBlank(hashedPassword)
        returns(bool success)
    {
        bytes32 addressableHash = keccak256(recipient, hashedPassword);

        require(remmittances[addressableHash].sender == msg.sender);
        require(remmittances[addressableHash].recipient == recipient);
        require(remmittances[addressableHash].balance > 0);
        require(remmittances[addressableHash].deadlineBlock >= block.number);

        uint withdrawBalance = remmittances[addressableHash].balance;
        remmittances[addressableHash].balance = 0;

        msg.sender.transfer(withdrawBalance);

        LogClaim(msg.sender, recipient, hashedPassword, withdrawBalance);

        return true;
    }

    function withdrawCommission()
        public
        isOwner
        isNotPaused
        isNotKilled
        returns(bool success)
    {
        require(commission > 0);

        uint comssionBalance = commission;
        commission = 0;

        msg.sender.transfer(comssionBalance);

        LogWithdrawCommission(msg.sender, comssionBalance);

        return true;
    }

    function toBytes(address a) constant returns (bytes32 b){
       assembly {
            let m := mload(0x40)
            mstore(add(m, 20), xor(0x140000000000000000000000000000000000000000, a))
            mstore(0x40, add(m, 52))
            b := m
       }
    }
}