import { z } from 'zod';

const id = z.string().regex(/^[^/]+$/);
const target = {
  companyId: z.string().min(1),
  source: z.enum(['employee', 'santei', 'bonus']),
  parentId: id,
  filingId: id,
};

export const AttachmentListSchema = z.object(target).strict();
export type AttachmentListInput = z.infer<typeof AttachmentListSchema>;

/** 5MB のファイルは base64 で約6.7MB（呼び出しの上限10MBに収まる） */
export const AttachmentUploadSchema = z.object({
  ...target,
  name: z.string().min(1).max(200),
  dataBase64: z.string().min(1).max(7_200_000),
  /** どの必要書類か（チェックリストの key。任意） */
  checklistKey: z.string().max(40).nullable().optional(),
}).strict();
export type AttachmentUploadInput = z.infer<typeof AttachmentUploadSchema>;

export const AttachmentGetSchema = z.object({ ...target, attachmentId: id }).strict();
export type AttachmentGetInput = z.infer<typeof AttachmentGetSchema>;

export const AttachmentDeleteSchema = AttachmentGetSchema;
export type AttachmentDeleteInput = AttachmentGetInput;
