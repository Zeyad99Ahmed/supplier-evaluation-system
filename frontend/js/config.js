// Where each service's API lives. This file is REPLACED by infra/deploy-frontend.sh with the real
// API Gateway URLs when the site is uploaded to S3 on Floci/AWS. It contains no secrets.
window.SES_CONFIG = {
  AUTH_API: 'http://localhost:4001',
  SUPPLIER_API: 'http://localhost:4002',
  ORDER_API: 'http://localhost:4003',
  EVALUATION_API: 'http://localhost:4004',
  ENVIRONMENT: 'local',
};
