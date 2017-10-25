var Remittance = artifacts.require("./ConvertLib.sol");

module.exports = function(deployer) {
  deployer.deploy(Remittance);
};
