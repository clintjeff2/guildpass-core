export interface ContractAddresses {
  membershipNFT: string;
  chainId: number;
}

export const addresses: ContractAddresses = {
  membershipNFT: process.env.MEMBERSHIP_NFT_ADDRESS || '',
  chainId: parseInt(process.env.CHAIN_ID || '31337', 10),
};

// Minimal ABI fragment for events the backend may subscribe to later
export const MembershipNFTAbi = [
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "to", "type": "address" },
      { "indexed": true, "internalType": "uint256", "name": "tokenId", "type": "uint256" },
      { "indexed": false, "internalType": "string", "name": "communityId", "type": "string" },
      { "indexed": false, "internalType": "uint256", "name": "expiresAt", "type": "uint256" }
    ],
    "name": "MembershipMinted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "tokenId", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "newExpiresAt", "type": "uint256" }
    ],
    "name": "MembershipRenewed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "tokenId", "type": "uint256" },
      { "indexed": false, "internalType": "bool", "name": "isSuspended", "type": "bool" }
    ],
    "name": "MembershipSuspended",
    "type": "event"
  }
] as const;
