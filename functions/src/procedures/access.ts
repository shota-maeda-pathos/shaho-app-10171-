import { AuthContext, requireOffice } from '../middleware/auth';
import { ProcedureDoc } from '../types/firestore';
import { notFound } from '../utils/errors';

export function requireProcedureAccess(auth: AuthContext, proc: ProcedureDoc): void {
  if (proc.deletedAt !== null) throw notFound('手続き');
  requireOffice(auth, proc.officeId);
  if (proc.targetOfficeId) requireOffice(auth, proc.targetOfficeId);
}
