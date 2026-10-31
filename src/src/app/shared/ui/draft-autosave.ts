import { DestroyRef, inject, signal } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from '../../core/services/auth.service';

export interface Draft { data: unknown; savedAt: string | null; mine: boolean }

/**
 * 1人の画面の入力の自動下書き保存（docs/ui-unification-design.md の5章）。
 * 数秒ごとに read() の内容を前回と比べ、変わっていればサーバー（procedureDraftSave）に置く。保存の状態は state に出し、
 * 操作バーの左（app-wizard の info）に「保存済み 10:42」と表示する。read() が null を返すあいだ（確定済み・直せないステップ）は保存しない。
 * 主ボタンでステップを確定したら clear(ステップ) で下書きを消す。注入の文脈（コンストラクタなど）で作る。
 */
export function createDraftAutosave(options: {
  procedureId: () => string;
  /** 下書きを置くステップ（ウィザードのステップの key） */
  step: () => string;
  /** 今の入力。保存しないときは null */
  read: () => unknown | null;
  /**
   * 最初に見た入力を「読み込んだ値」として保存しない（既定）。read() が入力を変えたあとだけ値を返す画面は false にして、最初の変更から保存する
   */
  baseline?: boolean;
  intervalMs?: number;
}) {
  const functions = inject(Functions);
  const auth = inject(AuthService);
  const state = signal('');
  let last = new Map<string, string>();
  let saving = false;
  const time = (iso: string) => new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });

  async function tick() {
    const procedureId = options.procedureId();
    const data = options.read();
    if (saving || !procedureId || data === null) return;
    const step = options.step();
    const json = JSON.stringify(data);
    if (last.get(step) === json) return;
    // 初めて見る入力（読み込んだばかりの値）は、変わったときだけ保存する
    if (options.baseline !== false && !last.has(step)) { last.set(step, json); return; }
    saving = true;
    state.set('下書きを保存しています…');
    try {
      const { data: r } = await httpsCallable<object, { savedAt: string | null }>(functions, 'procedureDraftSave')({
        companyId: auth.companyId, procedureId, step, data,
      });
      last.set(step, json);
      state.set(r.savedAt ? `下書きを保存済み ${time(r.savedAt)}` : '');
    } catch {
      state.set('下書きを保存できませんでした（入力は画面に残っています）');
    } finally {
      saving = false;
    }
  }

  const timer = setInterval(() => void tick(), options.intervalMs ?? 3000);
  inject(DestroyRef).onDestroy(() => clearInterval(timer));

  return {
    state,
    /** 手続きの下書きを読む（ステップごと）。読めなくても画面は続ける */
    async load(): Promise<Record<string, Draft>> {
      last = new Map();
      state.set('');
      try {
        const { data } = await httpsCallable<object, { drafts: Record<string, Draft> }>(functions, 'procedureDraftGet')({
          companyId: auth.companyId, procedureId: options.procedureId(),
        });
        return data.drafts;
      } catch {
        return {};
      }
    },
    /** 下書きを戻したときに、その内容を保存済みとして覚える（戻しただけで保存し直さない） */
    restored(step: string, data: unknown, savedAt: string | null) {
      last.set(step, JSON.stringify(data));
      state.set(savedAt ? `下書きを戻しました（${time(savedAt)} 保存）` : '');
    },
    /** ステップを確定したら下書きを消す */
    async clear(step: string) {
      last.delete(step);
      state.set('');
      try {
        await httpsCallable(functions, 'procedureDraftSave')({ companyId: auth.companyId, procedureId: options.procedureId(), step, data: null });
      } catch {
        // 消せなくても、確定した値のほうが優先される（次に開いたとき、確定済みのステップでは下書きを使わない）
      }
    },
  };
}
