import { onCall } from 'firebase-functions/v2/https';
import { premiumExemptionListSchema } from './schema';
import { listPremiumExemptions } from './service';
import { getAuthContext, requireRole } from '../../middleware/auth';

export const premiumExemptionList = onCall(
  async (request) => {
    const input = premiumExemptionListSchema.parse(request.data);
    const auth = await getAuthContext(request, input.companyId);
    requireRole(auth, 'admin', 'operator');
    return listPremiumExemptions(input, auth);
  },
);
