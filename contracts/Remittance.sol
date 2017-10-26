pragma solidity 0.4.15;

import "./Killable.sol";

contract Remittance is Killable{
    struct RemittanceStruct {
        address sender;
        address recipient;
        uint balance;
        uint deadlineBlock;
    }

    mapping (bytes32 => RemittanceStruct) public remittances;
    uint public escrowFee;
    uint public commission;

    event LogEscrow(address indexed sender, address indexed recipient, bytes32 indexed addressableHash, bytes32 hashedPassword, uint deadlineBlock, uint amount);
    event LogRemitt(address indexed recipient, bytes32 hashedPassword, uint amount);
    event LogClaim(address indexed sender, address indexed recipient, bytes32 hashedPassword, uint amount);
    event LogWithdrawCommission(address indexed who, uint commissionBalance);
    event LogSetEscrowFee(address indexed who, uint escrowFee);

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

    function setEscrowFee(uint contractEscrowFee)
        public
        isOwner
        isNotPaused
        isNotKilled
        returns(bool success)
    {
        escrowFee = contractEscrowFee;

        LogSetEscrowFee(msg.sender, contractEscrowFee);

        return true;
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
        require(msg.value > 0);

        bytes32 addressableHash = keccak256(recipient, hashedPassword);

        commission = commission + escrowFee;
        uint remittanceBalance = msg.value - escrowFee;

        remittances[addressableHash].sender = msg.sender;
        remittances[addressableHash].recipient = recipient;

        // This remittance entry could already exist, allow topping it up
        if (remittances[addressableHash].balance > 0) {
            require(remittances[addressableHash].balance + remittanceBalance > remittances[addressableHash].balance);

            remittances[addressableHash].balance += remittanceBalance;
        }
        else {
            remittances[addressableHash].balance = remittanceBalance;
        }

        if (deadlineBlock > 0) {
            remittances[addressableHash].deadlineBlock = block.number + deadlineBlock;
        }

        LogEscrow(msg.sender, recipient, addressableHash, hashedPassword, deadlineBlock, msg.value);

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

        require(remittances[addressableHash].recipient == msg.sender);
        require(remittances[addressableHash].balance > 0);

        uint withdrawBalance = remittances[addressableHash].balance;
        remittances[addressableHash].balance = 0;

        remittances[addressableHash].sender = 0;
        remittances[addressableHash].recipient = 0;
        remittances[addressableHash].deadlineBlock = 0;

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

        require(remittances[addressableHash].sender == msg.sender);
        require(remittances[addressableHash].recipient == recipient);
        require(remittances[addressableHash].balance > 0);
        require(remittances[addressableHash].deadlineBlock <= block.number);

        uint withdrawBalance = remittances[addressableHash].balance;
        remittances[addressableHash].balance = 0;

        remittances[addressableHash].sender = 0;
        remittances[addressableHash].recipient = 0;
        remittances[addressableHash].deadlineBlock = 0;

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
}