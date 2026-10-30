import { onCall } from 'firebase-functions/v2/https';
import { premiumExemptionCreateSchema } from './schema';
import { createPremiumExemption } from './service';
import { getAuthContext, requireRole } from '../../middleware/auth';

export const premiumExemptionCreate = onCall(
  async (request) => {
    const input = premiumExemptionCreateSchema.parse(request.data);
    const auth = await getAuthContext(request, input.companyId);
    requireRole(auth, 'admin', 'operator');
    return createPremiumExemption(input, auth);
  },
);
