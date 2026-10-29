import { Timestamp } from 'firebase-admin/firestore';
import { portalAccessDeadline } from './access-period';
test('退職日がない場合は会社独自の期限を作らない',()=>{expect(portalAccessDeadline({})).toBeNull();});
test('退職後3か月を月末の存在する日へ補正する',()=>{expect(portalAccessDeadline({resignationDate:Timestamp.fromDate(new Date('2026-11-30T00:00:00Z'))})?.toISOString()).toBe('2027-02-28T00:00:00.000Z');});
test('明示された本人ポータル期限を優先する',()=>{expect(portalAccessDeadline({portalAccessUntil:Timestamp.fromDate(new Date('2026-12-01T00:00:00Z'))})?.toISOString()).toBe('2026-12-01T00:00:00.000Z');});
