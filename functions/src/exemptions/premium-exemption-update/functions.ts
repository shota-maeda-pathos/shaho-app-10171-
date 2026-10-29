import { onCall } from 'firebase-functions/v2/https';
import { getAuthContext } from '../../middleware/auth';
import { validate } from '../../middleware/validation';
import { premiumExemptionUpdateSchema } from './schema';
import { updatePremiumExemption } from './service';
export const premiumExemptionUpdate = onCall({ region: 'us-central1' }, async request => {
  const input = validate(premiumExemptionUpdateSchema, request.data);
  return updatePremiumExemption(input, await getAuthContext(request, input.companyId));
});
