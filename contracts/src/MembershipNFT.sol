// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

/**
 * MembershipNFT
 * - Simple ERC721 representing community membership
 * - Each token has an expiry timestamp
 * - Admins (approved by owner) can mint and renew
 * - Suspension toggles active status without burning
 * - Tokens are scoped to a community via communityId
 */
contract MembershipNFT is ERC721, Ownable {
    uint256 public nextTokenId = 1;
    mapping(uint256 => uint256) public expiry;
    mapping(uint256 => bool) public suspended;
    mapping(uint256 => string) public communityOf;
    mapping(address => bool) public admins;
    mapping(address => mapping(string => uint256)) public activeTokenOf; // wallet -> community -> tokenId

    event AdminUpdated(address indexed admin, bool approved);
    event MembershipMinted(address indexed to, uint256 indexed tokenId, string communityId, uint256 expiresAt);
    event MembershipRenewed(uint256 indexed tokenId, uint256 newExpiresAt);
    event MembershipSuspended(uint256 indexed tokenId, bool isSuspended);

    modifier onlyAdmin() {
        require(admins[msg.sender] || msg.sender == owner(), "NOT_ADMIN");
        _;
    }

    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) Ownable(msg.sender) {}

    function setAdmin(address admin, bool approved) external onlyOwner {
        admins[admin] = approved;
        emit AdminUpdated(admin, approved);
    }

    function mint(address to, string calldata communityId, uint256 validForSeconds) external onlyAdmin returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        _safeMint(to, tokenId);
        uint256 expiresAt = block.timestamp + validForSeconds;
        expiry[tokenId] = expiresAt;
        suspended[tokenId] = false;
        communityOf[tokenId] = communityId;
        // overwrite any previous active token pointer for this community
        activeTokenOf[to][communityId] = tokenId;
        emit MembershipMinted(to, tokenId, communityId, expiresAt);
    }

    function renew(uint256 tokenId, uint256 extendBySeconds) external onlyAdmin {
        require(_exists(tokenId), "NO_TOKEN");
        uint256 current = expiry[tokenId];
        uint256 base = current > block.timestamp ? current : block.timestamp;
        uint256 newExpiry = base + extendBySeconds;
        expiry[tokenId] = newExpiry;
        emit MembershipRenewed(tokenId, newExpiry);
    }

    function setSuspended(uint256 tokenId, bool value) external onlyAdmin {
        require(_exists(tokenId), "NO_TOKEN");
        suspended[tokenId] = value;
        emit MembershipSuspended(tokenId, value);
    }

    function isActive(uint256 tokenId) public view returns (bool) {
        if (!_exists(tokenId)) return false;
        if (suspended[tokenId]) return false;
        return expiry[tokenId] > block.timestamp;
    }
}
