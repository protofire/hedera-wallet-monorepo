import type { TemplateConfig } from './constants.extra'

/**
 * THIS FILE IS AUTO-GENERATED. DO NOT EDIT.
 * Generated from /networks/shared/config.json
 */
const TEMPLATE_CONFIG = {
  EIP155: false,
  SUPPORTED_VERSIONS: ['1.3.0', '1.4.1'],
  SAFE_DEPLOYMENTS_OVERRIDE: {
    '4441': {
      '1.3.0': 'canonical',
      '1.4.1': null,
    },
  },
  SAFE_UTILS_SUPPORTED: true,
  EXTRA_FOOTER_LINKS: [],
  IS_LICENSED: false,
  LOGO_DIMENSIONS: {
    HEADER: {
      H: '35px',
    },
  },
} as TemplateConfig
export default TEMPLATE_CONFIG
