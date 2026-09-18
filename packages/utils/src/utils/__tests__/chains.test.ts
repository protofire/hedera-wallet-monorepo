import { FEATURES, hasFeature, isHederaChain } from '../chains'

describe('chains', () => {
  describe('isHederaChain', () => {
    it('should return true for Hedera mainnet', () => {
      expect(isHederaChain('295')).toBe(true)
    })

    it('should return true for Hedera testnet', () => {
      expect(isHederaChain('296')).toBe(true)
    })

    it('should return false for non-Hedera chains', () => {
      expect(isHederaChain('1')).toBe(false)
      expect(isHederaChain('100')).toBe(false)
    })
  })

  describe('hasFeature with FEATURES.HEDERA', () => {
    it('should return true when the chain config lists HEDERA', () => {
      expect(hasFeature({ features: ['HEDERA'] }, FEATURES.HEDERA)).toBe(true)
    })

    it('should return false when the chain config does not list HEDERA', () => {
      expect(hasFeature({ features: ['ERC721'] }, FEATURES.HEDERA)).toBe(false)
    })
  })
})
