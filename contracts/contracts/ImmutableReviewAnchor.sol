// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAILicenseVerifier {
    function hasModelLicense(address account, uint256 modelId) external view returns (bool);
}

/// @title ImmutableReviewAnchor
/// @notice Anchors a review hash and its IPFS document for a verified license holder.
/// @dev There is intentionally no update or delete path. The marketplace DB can
/// moderate visibility while this contract preserves the original audit trail.
contract ImmutableReviewAnchor {
    IAILicenseVerifier public immutable licenseNFT;
    mapping(bytes32 reviewHash => bool anchored) public anchoredReviews;

    event ReviewAnchored(
        bytes32 indexed reviewHash,
        uint256 indexed modelId,
        address indexed reviewer,
        uint8 score,
        string reviewURI
    );

    constructor(address licenseNFTAddress) {
        require(licenseNFTAddress != address(0), "ReviewAnchor: zero license NFT");
        licenseNFT = IAILicenseVerifier(licenseNFTAddress);
    }

    function anchorReview(
        bytes32 reviewHash,
        uint256 modelId,
        uint8 score,
        string calldata reviewURI
    ) external {
        require(reviewHash != bytes32(0), "ReviewAnchor: empty hash");
        require(!anchoredReviews[reviewHash], "ReviewAnchor: already anchored");
        require(score >= 1 && score <= 5, "ReviewAnchor: invalid score");
        require(bytes(reviewURI).length > 0, "ReviewAnchor: empty URI");
        require(licenseNFT.hasModelLicense(msg.sender, modelId), "ReviewAnchor: license required");

        anchoredReviews[reviewHash] = true;
        emit ReviewAnchored(reviewHash, modelId, msg.sender, score, reviewURI);
    }
}
