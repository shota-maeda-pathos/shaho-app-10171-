# 引継ぎ（最新）

更新：2026-10-30（段階6 年齢到達に続き、有期雇用の満了・二以上事業所・雇用条件の変更・事業所間異動を作り、画面で完了まで確認。段階6の残りは画面での確認不足の項目。次は段階7）。新しいセッションは最初にこのファイルを読む。応答は日本語で行う。

## 1. 目的と前提

- 目標：`C:\Users\pluser1\Desktop\社会保険管理システム 機能カタログ ちょーろんぐばーじょん.txt`（機能カタログ第2版）どおりに作り、労務担当の初心者でも迷わず使え、大人数の企業にも対応する。迷ったらカタログを正とする（ユーザー手元の設計書 `Downloads/screen-flow.md` 等はカタログと差がある）。
- 構成：Angular（`src/`）＋ Cloud Functions 2nd Gen（`functions/`、Callable・Zod）＋ Firestore。Firebase プロジェクト `kensyu10171`（本番だがデータはテスト用のみ）。Firestore は **asia-northeast1**、関数は原則 us-central1。
- GitHub：`shota-maeda-pathos/shaho-app-10171-`（公開）。最新コミットは `git log` で確認する。push はユーザーがアプリ外の PowerShell で行う。

## 2. 経緯（要約）

1. 以前は機能を横に広げて作ったが、どの業務も最後まで通らず計算誤りも多かった。2026-10-29 にカタログとの乖離を洗い出し、`docs/roadmap.md`（段階0〜10）に一本化した。
2. 段階0：独立リポジトリ化、チェックリスト `docs/catalog-checklist.md` 作成。
3. 段階1：法令計算をサーバーの純粋関数 `functions/src/insurance/calculator/` に集約（端数処理・等級表・支払基礎日数・随時改定・免除・得喪・適用判定）。
4. 段階2：共通UI部品 `src/src/app/shared/ui/`（ウィザード・対象者一覧・状態色・用語集・デザイントークン）。
5. 段階3：入社（個人型の見本）`/onboarding`。招待→本人入力→台帳→雇用条件→資格取得届・承認→提出→完了を画面で確認。
6. 段階4：毎月の処理（一括型の見本）`/monthly`。300名・2か月分で最後まで通した（下記）。途中で本番の料率マスタの単位誤りを発見・修正した。
7. 段階5：ホームとナビ。やることリスト・ライフイベントのカード・サイドバー5項目（下記）。
8. 段階6（途中）：退職のウィザード `/resignation/:id`、扶養のウィザード `/dependents/:id`、産休・育休のウィザード `/leaves/:id`、算定基礎届（一括型）`/santei`、賞与（一括型）`/bonus`、随時改定・終了時改定のウィザード `/revisions/:id`、年齢到達のウィザード `/age-events/:id`（下記）。いずれも承認・模擬電子申請・完了まで画面で確認した。

## 3. 決定事項（ユーザー承認済み）

- **縦に1本ずつ仕上げる**（データ→計算→画面→一括操作→実ブラウザー確認）。**完了は実ブラウザーで確認できた項目だけ ✅**。ビルドやテストの成功だけでは完了にしない。
- **法令計算はサーバーのみ**（`calculator/`）。画面から送られた値は信用せず、サーバーで再計算して承認申請する。
- **手続きは2つの型**：個人型（`app-wizard`）と一括型（`app-target-list`：要対応だけ表示・全員に一括操作・保留・失敗した人だけ再実行）。
- **料率は ‰（1000分の1）で登録する**（例：健保 98.5、本人 49.25）。1未満の料率では計算を止める安全策あり。
- 届出の状態は内部3軸（社内承認・模擬申請・紙提出）、画面はカタログの状態名で表示。
- サイドバーは5項目（ホーム／手続きを始める／毎月の処理／従業員／承認）＋開閉式の「その他」（進行中の手続き・届出・集計・用語集・設定）。

## 4. 重要な仕様（段階4 毎月の処理）

- 単位は **事業所×給与の支給月**。控除する保険料の月は事業所の `deductionMethod`（`previous`＝翌月控除なら前月分、`current`＝当月分）で決まる（`monthly/rules.ts` の `premiumMonthFor`）。
- 6ステップ：給与を取り込む → 給与の確認 → 保険料を計算 → 結果の確認 → 明細を公開 → 徴収を記録。各ステップの対象者一覧は要対応を先に出し、承認者には承認待ちのステップを先に開く。
- サーバー `functions/src/monthly/`：
  - `monthlyRunOverview`：全員分の状況（上限3000名）。前月差額と理由、給与と等級の開き（25%以上）、徴収方法（給与控除／別途入金）、料率の変化（`rateFingerprint`）、差し戻し理由（`lastRejection`）、給与項目マスタを返す。
  - `monthlySalaryImport`：CSVの確認（dryRun）と取込。誤りの行は行番号つきで返し取り込まない。手当の列は給与項目マスタ（`settings/salaryItems`、`monthlySalaryItemsUpdate`）の名前、または「固定:〇〇」「非固定:〇〇」。
  - `monthlyJobStart`/`monthlyJobGet`/`monthlyJobChunk`：一括処理。`monthlyJobs/{id}/chunks`（25名ずつ）を Firestore トリガー（asia-northeast1）が並行処理。失敗は `failures/`。10分超は停止扱い。画面を開き直しても直前の失敗を読み込み直して再実行できる。
  - そのほか：`monthlyRunHold`（保留。月ごと）、`monthlySalaryNoPay`（無給）、`monthlyCollectionEntry`（給与控除・別途入金・返金。`collectionReceipts/{保険料の月}`）。
- 月次計算は給与の承認を求めない（無給の休職者も計算する）。明細の公開時に給与へ `deductedPremiumMonth` を記録し、ポータルはその月の保険料を表示する。
- 承認：既存の承認申請（決まったID `salary-{月}-v{版}` など）を使う。まとめて承認するときは通知1件（`{ notify: false }`）。依頼した本人は承認できない。承認一覧 `approvalRequestList` は承認待ちを件数で切らずに返す。
- 給与の1人分の入力 `/salary/:id`：手当・支払基礎日数・現物給与・遡及差額を読み込み・保存。毎月の処理から開くと保存後に戻る。

## 4-2. 重要な仕様（段階5 ホームとナビ）

- ホーム `/home` はやることリスト（期限の近い順、「続きから」／待ちは「状況を見る」）と「新しく始める」のカード。統計の表は外した（集計は段階9）。
- サーバー `functions/src/home/`：`homeTodos`（us-central1）。
  - 入社：ウィザードの今のステップから次にやることを出す。期限は資格取得届の期限。本人の入力待ち・承認待ち（自分が依頼したものは待ち）・差し戻しの理由を出す。
  - 退職・扶養：`wizardTodo`（ウィザードの今のステップ・承認待ち・差し戻し・返戻と届出の期限）。それ以外の手続き：返戻→進行中→着手可能の順で最初のステップ（ウィザード化するまでの仮。`procedureTodo`）。
  - 毎月の処理：事業所ごとに当月分と、前後の月で始めて終わっていないもの。`monthlyOverview` を呼び、**画面と同じ判定**（`home/monthly-progress.ts` の `stepTone`、画面の `monthly.types.ts` の `stepState` と対応。判定を変えるときは両方を直す）で次のステップと残り人数を出す。期限は給与の支給日（`paymentDay`）。最初は最後の一括処理から推測したが、承認一覧で承認した場合などに誤ったため改めた。
  - 承認者だけの人には「あなたの番」だけを返す。読み込みは約5秒（事業所×月ごとに全員分を読むため）。
- ライフイベントのカード `features/procedures/life-events.ts`（9種）をホームと `/procedures/new` で共通に使う。従業員を選ぶ業務はカードの下で従業員を選ぶ。退職・扶養はウィザードへ、休業・異動はまだ従業員詳細へ進む。
- サイドバーの選択表示は URL から1つだけ決める（`layout.ts` の `activeRoute`）。旧 `/operations` は `/procedures/new` へ転送し、画面のファイルは削除した。

## 4-3. 重要な仕様（段階6 退職）

- 入口：「人が退職する」のカード（`procedure-start.ts` で従業員を選ぶ）と、従業員詳細の「退職」ボタン（`?action=loss` も同じ）。どちらも `resignationStart` で手続きを作ってウィザードを開く。同じ人の進行中の退職手続きがあればそれを開く。従業員詳細の旧い退職パネル（`employeeResign` を直接呼ぶ）は削除した。`employeeResign` 関数自体は残っている。
- サーバー `functions/src/resignation/`（us-central1）：`resignationStart`・`resignationGet`・`resignationPreview`（kind: entry／settlement）・`resignationUpdate`（step: entry／settlement／account／filing／complete）。手続きは `procedureType: 'loss'` に `resignation` の状態を持つ（旧方式の退職手続きにはない）。ステップは `templates.ts` の `RESIGNATION_STEPS`。
- 法令の判定は `resignation/rules.ts`（純粋関数・テストあり）：喪失日＝翌日、保険料は喪失月の前月分まで（月末退職は退職月も、同月得喪は1か月分）、喪失届の期限＝喪失日＋5日、閲覧期間＝喪失日から3か月の応当日の前日まで、70歳以上被用者不該当、外国人の脱退一時金の案内。
- 最後の保険料：最後の月とその前2か月について、`monthlyInsurance`（承認済み・計算済み）と `collectionReceipts` を読み、未計算の月は最新の等級から見込みを出す。等級がない月は「計算できません」で決められない。集め方は「いつもの控除月の給与」→「最後の給与からまとめて（前月分と当月分）」→「別途入金」。「退職後に支給する給与はない」を選ぶと、まとめての控除はできない。別途入金・返金があれば通知する。実際の徴収の記録は毎月の処理の「徴収を記録」で行い、ウィザードは開くたびに最新の残りを出す。
- 退職日を登録すると、台帳の `isActive=false`・`resignationDate`・`qualificationLostDate`・`portalAccessUntil` を書く（未来の退職日でもすぐ退職済みになるのは旧方式と同じ）。利用者には `suspendFrom`（喪失日）・`loginDisabledFrom`（閲覧期間の翌日）を書き、`middleware/auth.ts` と画面の `auth.service.ts` が東京の今日と比べて閲覧専用・ログイン停止にする。権限（roles）は消さない。喪失日を過ぎていれば `isSuspended=true` も書く（日付を見ない旧い関数のため）。
- 資格喪失届：喪失原因（退職等／死亡）・喪失する保険・70歳以上被用者不該当・最終の標準報酬月額・保険証の回収枚数。承認申請は入社と同じ仕組み（`linkApprovalToProcedure`）。社会保険に加入していない人は届出・承認・提出が「不要」になり、完了は手続き側で閉じる。
- ホーム：`home/service.ts` の `resignationTodo`。期限は喪失届の期限（提出後は出さない）、別途回収の額を補足に出す。

## 4-4. 重要な仕様（段階6 扶養）

- 入口：「家族が増えた・減った」のカード（`procedure-start.ts` の `start()` でウィザードの業務をまとめて扱う）と、入社のウィザードの完了画面の「扶養の手続きを始める」（本人が申し出た家族を「扶養に入れる」として引き継ぐ）。同じ人の進行中の扶養の手続きがあればそれを開く。健康保険に加入していない人は始められない。
- サーバー `functions/src/dependent-change/`：`dependentChangeStart`・`dependentChangeGet`・`dependentChangePreview`（入れかけの内容でも判定できる）・`dependentChangeUpdate`（step: change／filing／complete）。手続きは `procedureType: 'dependent_change'` に `dependentChange` の状態を持つ。ステップは `DEPENDENT_WIZARD_STEPS`。
- 判定は `dependent-change/rules.ts`（純粋関数・テストあり）：収入要件（原則130万円未満、19〜22歳（配偶者を除く）150万円未満、60歳以上・障害者180万円未満。年齢は認定日の年の12月31日時点）、75歳以上は不可、同居が要件の続柄（その他の親族）、別居の仕送り、第3号被保険者（20〜59歳の配偶者）、期限（いちばん早い異動日＋5日）、添付書類の目安。基準以上でも理由を入れれば届け出られる。
- 1つの手続きで、扶養に入れる・外す・変わった人を複数まとめて届け出る（届出は1件、`被扶養者一覧` に人ごとの行）。**台帳（`dependents`）への反映は完了時**（提出前に台帳を変えて届出と食い違うのを防ぐ）。追加は `certification: 'certified'`、外す人は `disqualificationDate`・`disqualificationReason`・`certification: 'removed'`。続柄は英字の値（spouse など）で持ち、旧データの日本語は `toRelationship` で寄せる。
- 退職・扶養で共通の小さな処理は `procedures/wizard.ts`、ホームの出し方は `home/service.ts` の `wizardTodo`。
- `dependentList` が本番にない複合索引を要していて、従業員詳細の扶養家族タブが読めなかった（以前から）。索引に頼らない形に直した。

## 4-5. 重要な仕様（段階6 産休・育休）

- 入口：「産休・育休に入る／戻る」のカード（`procedure-start.ts` で従業員と休業の種類を選ぶ）と、従業員詳細の「休業」タブの「産休の手続きを始める」「育休の手続きを始める」。同じ人の進行中の同じ種類の手続きがあれば、それを開く。産休は女性だけ。社会保険に加入していない人は始められない。「休業」タブの旧い登録フォームは介護休業だけにした（`leaveCreate` は介護用に残る）。
- 1つの休業につき1つの手続き（`procedureType: 'maternity_leave'／'childcare_leave'` に `leaveProcedure` の状態）。ステップは `LEAVE_WIZARD_STEPS`：期間を決める→申出書を作る→承認→提出→休業中のことと復帰を記録する（`during`）→完了。
- サーバー `functions/src/leave-procedure/`（us-central1）：`leaveProcedureStart`・`leaveProcedureGet`・`leaveProcedurePreview`（期間・休業中のことの判定。保存しない）・`leaveProcedureUpdate`（step: plan／filing／event／complete）。
- 判定は `leave-procedure/rules.ts`（純粋関数・テストあり）：産前42日（多胎98日）・産後56日、休み始める日の範囲、子が1歳・1歳6か月・2歳・3歳に達する日（延長の区切り）、本人が出産した子は産後56日の後から、免除の月（月末・14日）と賞与の免除、産休の届出の期限（終了から1か月）、育休は「速やかに」、復帰した月。
- 休業中のこと（`judgeLeaveEvent`）：産休は出産日（予定日と違えば変更届。出産後に申出書を出していれば不要）と終了（予定より早ければ終了届。産後6週間は休む）。育休は延長（申出書（延長））と終了（早ければ終了届）。**予定どおりの終了は届出不要**。届出が要るときは届出のステップ（作る・承認・提出）をリセットして同じ手続きでもう一度通る。提出済みの届出は `history`。承認を依頼する前なら、届出のステップの「記録を直す」から記録をやり直せる（記録前のステップと参照を `pending` に持って戻す）。
- 届出の種類：産休の変更届・終了届は同じ様式の新しい種類 `maternityLeaveChange`（産前産後休業取得者変更（終了）届）。育休の延長は `childcareLeaveStart`（区分＝延長）、終了は `childcareLeaveEnd`。
- **免除**：申出書を作るときに休業（`leaves`。`procedureId` を持つ）と免除（`premiumExemptions`、`status: 'pending'`・`filingId`・`leaveId`）を作る。毎月・賞与の計算（`decideExemption`）は、`pending` でも `filingId` の申出書が承認済みなら免除する（以前の「承認しても免除が効かない」不具合の修正）。ウィザードを開くと免除を `active`・`approvedAt` に書き換える。休業中のことを記録すると、休業の期間と免除の月を合わせ直す。免除の前に免除なしで計算済みの月があれば、毎月の処理で計算し直すよう案内する（自動では計算し直さない）。
- 完了：復帰後の終了時改定の案内（復帰した月から3か月の給与）と等級の見直し画面へのリンク。産休の完了後は「育休の手続きを始める」で、子・開始日（産休の翌日）・終了予定日（1歳に達する日）を引き継ぐ。
- ホーム：`home/service.ts` の `leaveTodo`。休業中は「待ち」で、期限は終了予定日（出産前は「出産したら出産日を記録する」）。

## 4-6. 重要な仕様（段階6 算定基礎届）

- 一括型。単位は **事業所×年**（`santeiRuns/{officeId}_{year}`。保留 `holds/`・決め方 `decisions/`・届出 `filings/`）。画面 `/santei?officeId=&year=`（admin・operator・approver）。入口はライフイベントのカード「年1回の算定基礎届（7月）」とホームのやること。旧 `santei-list`・`santei-detail` 画面は削除した。
- 4ステップ：対象者を確かめる → 等級の承認 → 算定基礎届を作る → 届出の承認と提出。各ステップの状態は画面の `santei.types.ts` の `stepState` とサーバーの `santei/progress.ts` の `santeiStepState` が同じ判定（変えるときは両方を直す）。ホーム（`home/service.ts` の `santeiTodos`）は `santeiProgress` を使い、6月1日〜7月10日は始めていなくても、それ以外は始めた年だけ出す。期限は7月10日。
- 判定 `santei/santei-calc.ts`（純粋関数・テストあり）：4〜6月に**支払った**承認済みの給与（`salaries/{支給月}`）。除外（適用外・6月1日以降の取得・7月1日までの喪失・7〜9月の随時改定の等級あり）、保留（給与の未登録・未承認）、決め方が必要（支払基礎日数の基準を満たす月がない。一般17日・パートは17日がなければ15日・短時間11日）。決め方は「従前の標準報酬月額で決める」（今の等級がある人だけ）。資格取得前の月は使わない。遡及差額は判定から除き、届出の通貨には含める。4月1日〜7月1日に在籍していない人は一覧に出さない。
- サーバー `functions/src/santei/`：`santeiRunOverview`（全員分、上限3000名）・`santeiRunHold`・`santeiDecision`・`santeiJobStart`／`santeiJobGet`／`santeiJobChunk`（`santeiJobs/{id}/chunks` を東京のトリガーで25名ずつ。毎月の処理と同じ作り。`authOf`・`getAllChunked` は `monthly/service.ts` から使う）・`santeiFilingCreate`・`santeiFilingUpdate`・`santeiFilingGet`・`sampleSanteiCreate`。
- 等級の承認は既存の承認申請（`requestType: 'grade'`、対象は `grades/{年}-09`、`targetVersion: 0`）。メタデータに月ごとの値・使った月・区分・従前の等級と改定月を残す。承認する直前にサーバーで判定し直し、内容が変わっていれば承認しない（差し戻して出し直す）。9月の等級が定時決定以外で既にあれば依頼・承認しない。承認一覧からの個別承認もできる（その場合は再判定しない）。
- 届出は承認された等級の申請内容から作る（`santeiFilingPerson`：総計・平均額は基準を満たした月の支払額、遡及支払があれば修正平均額、備考の番号 1・4・6・7・9 と「その他」の文言）。1件に1000名まで。届出は従業員の下ではなく `santeiRuns/.../filings` にあり、状態は 下書き→承認待ち→承認済み→提出済み（取り消し・差し戻しは下書きへ）。届出の承認は依頼した人以外の管理者・承認者。**届出一覧・承認一覧には出ない**（段階7で横断機能に入れる）。番号は取り消した届出も数える。
- PDF（画面）`official-filing-pdf.ts` の `createSanteiFilingPdf`：公式様式に1枚5人（行の間隔155）。様式の MediaBox の原点は (-8.39, 8.39) のため、pdf.js で測った位置には 13.4 を足して使う。遡及支払額の欄・事業所整理記号・被保険者整理番号（未登録なら）は空欄で警告を出す。
- 旧 `santeiPreview`・`santeiSubmit` はコードから外したが本番に残っている（削除は要確認）。`filing-auto-generate` の算定基礎届（1人ずつ・17日だけの判定）も残っているが、画面からは使っていない。

## 4-7. 重要な仕様（段階6 賞与）

- 一括型。単位は **事業所×賞与の支給月**（`bonusRuns/{officeId}_{yyyy-mm}`。保留 `holds/`・届出 `filings/`。不支給報告書の記録 `nonPayment`）。画面 `/bonus?officeId=&month=`（admin・operator・approver）。入口はライフイベントのカード「賞与を払った」とホームのやること。旧 `/premium/bonus` は `/bonus` へ転送し、旧画面 `premium-bonus` は削除。従業員詳細の賞与タブは見るだけにした（旧 `bonusCreate`・`bonusUpdate` は画面から使っていないが本番に残る）。
- データ：`employees/{id}/bonuses/{支給月}` のまま（承認申請の決まったID `bonus-{月}-v{版}`・`bonusInsurance-{月}-v{版}` と互換）。`payments: [{date, cash, inKind}]` を足し、同じ月の支給は合算（`totalAmount`・`standardBonusAmount`＝合算額の千円未満切捨て・`paymentDate`＝初回の支給日）。旧データ（payments なし）は支給日なしの1回として読む。
- 判定 `bonus/bonus-calc.ts`（純粋関数・テストあり）：年度（4月始まり）、同月合算、上限（健保は年度累計573万円・厚年は月150万円）と上限に近い（8割超）知らせ、保険料と届出の要否（支給日で資格を判定。資格喪失月で喪失日より前の支給は「保険料なし・届出あり」、喪失日以後・適用外・取得前は届出不要）、年度の4回目（支給日ごと）の警告、届出の1人分（備考1＝70歳以上被用者・3＝同一月内の賞与合算と初回支払日）、期限（初回の支給日＋5日）、CSV（同じ人の複数行＝同月の別の支給。誤りのある人は全行取り込まない）。
- `bonusInsuranceCalculate` を直した：健保の年度累計を**前の月の承認済みの標準賞与額からサーバーで数える**（手入力の `cumulativeBonusAmount` は使わない。前の月に未承認の賞与があれば計算しない）。資格喪失月は0円、届出不要の人は計算しない。計算結果に `priorCumulativeBonusAmount`・`bonusTarget` などを残し、年度累計が変わったら「計算し直し」にする。
- 4ステップ：賞与を登録する（CSVファイル・**表の貼り付け**・1人ずつの入力。2回目の支給は1人分の入力で足す）→ 賞与額の承認 → 保険料の計算と承認 → 賞与支払届（作成・承認・模擬電子申請／紙）。各ステップの状態は画面の `bonus.types.ts` の `stepState` とサーバーの `bonus/progress.ts` の `bonusStepState` が同じ判定（変えるときは両方を直す）。
- サーバー `functions/src/bonus/`（us-central1）：`bonusRunOverview`（全員分、上限3000名）・`bonusRunHold`・`bonusRunImport`（dryRun あり）・`bonusRunEntry`・`bonusRunNonPayment`・`bonusJobStart`／`bonusJobGet`／`bonusJobChunk`（`bonusJobs/{id}/chunks` を東京のトリガーで25名ずつ。操作は賞与額の承認依頼・承認、保険料の計算・承認依頼・承認）・`bonusFilingCreate`・`bonusFilingUpdate`・`bonusFilingGet`・`sampleBonusCreate`。承認依頼した人は run の `bonusReview`・`premiumReview` に残し、承認者には「あなたの番」で出す。
- 届出は算定基礎届と同じ作り（`bonusRuns/.../filings`、1件に1000名まで、状態は 下書き→承認待ち→承認済み→提出済み、届出一覧・承認一覧には出ない）。PDF（画面）`official-filing-pdf.ts` の `createBonusFilingPdf`：1枚10人（行の間隔 77.87＝原票160%の値）、共通の支払日を各ページに書き、各行の支払日は共通と違うときだけ書く。個人番号（70歳以上被用者）の欄は書かず警告を出す。
- 不支給：事業所の `bonusMonths`（設定の事業所一覧で登録。`officeList` が返すようにした）。予定月が終わって賞与が1件もなく、不支給報告書の提出日の記録もなければ、賞与の画面とホームに「賞与不支給報告書の提出が必要です」。報告書そのものの作成は段階7。
- ホーム：`home/service.ts` の `bonusTodos`。始めた支給月（半年以内）で終わっていないものと、過去3か月の予定月の不支給。期限は賞与支払届の期限。

## 4-8. 重要な仕様（段階6 随時改定・終了時改定）

- 個人型。1つの手続きは `procedureType: 'monthly_change'` に `gradeRevision` の状態（種類 `occasional`／`maternityEnd`／`childcareEnd`・起点の月・決めた判定 `decision`・届出・対象外で終えた理由）。ステップは `REVISION_WIZARD_STEPS`：変動を確かめる（終了時改定は休業の終わりと申出）→判定する→届出を作る→承認→提出→完了。
- 入口：ライフイベントのカード「給料が大きく変わった」（`procedure-start.ts` で従業員と「見直しのきっかけ」を選ぶ）、従業員詳細の「随時改定」ボタン、産休・育休の完了画面の「終了時改定の手続きを始める」（休業を終えた日・子を引き継ぐ。`sourceProcedureId`）、毎月の処理の詳細の「随時改定の対象か確かめる」（変動月を引き継ぐ）、ホームのやること。いずれも `/revisions/new?employeeId=&kind=&startMonth=&sourceProcedureId=` を開き、画面が `gradeRevisionStart` を呼んで手続きの画面へ移る（同じ人の進行中の同じ改定があればそれを開く）。旧 `/employees/:id/revision` はここへ転送し、旧画面と旧 `gradeRevisionCheck`・`gradeRevisionSubmit` はコードから外した（本番には残る）。
- サーバー `functions/src/grade-revision/`（us-central1）：`gradeRevisionStart`・`gradeRevisionGet`・`gradeRevisionPreview`（入れかけの内容で判定。保存しない）・`gradeRevisionUpdate`（step: change／decide（revise・close）／filing／complete）・`sampleRevisionCreate`。判定は毎回 `evaluate`（給与・改定前の等級・料率の等級表を読む）を通し、届出を作る直前にも判定し直して、決めた内容と違えば作らない。新しい等級を使う月に別の決定の等級があれば止める。
- 判定 `grade-revision/rules.ts`（純粋関数・テストあり）：随時改定は変動月と前月の固定的賃金（前月の給与がなければ `previousTotalFixedWage`、なければ担当者が向きを選ぶ）、3か月とも承認済み・支払基礎日数（一般17日・短時間11日）、遡及差額を除いた平均、健保・厚年別に2等級差（上限・下限の特例。従前の報酬月額は担当者の入力か等級の `basisRemuneration`）と向きの一致。終了時改定は休業を終えた日の翌日が属する月から3か月、基準に満たない月を除く（パート15日の特例）、1等級差、本人の申出・子が3歳未満・翌日から次の休業に入らない。どちらも4か月目から適用。
- 承認は届出の1回（入社と同じく承認申請の `metadata.grade`）。承認で届出が承認済みになり、等級（`grades/{適用月}`、`determinationType: occasional／leaveEnd`、`basisMonths`、`filingId`）が確定する。`approvalRequestApprove` を直した。改定前の等級で計算済みの月があれば、完了画面で計算し直しを案内する（自動では計算し直さない）。
- 毎月の処理：`monthlyRunOverview` が支給月を3か月目とする人（変動月＝支給月の2か月前）について固定的賃金の変動を見て判定し、行に `revision`（知らせ・手続き）を返す。手続きを始めるまでは注意（`warnings`）に出す（「結果の確認」のステップで「確認が必要」）。対象の人には「給与と等級の開き」の注意は出さない。
- 届出：④ `remunerationMonthlyChange`（既存の様式）、⑪ `maternityLeaveEndChange`・⑫ `childcareLeaveEndChange`（新規。公式様式 `src/public/filing-forms/maternity-end-change.pdf`・`childcare-end-change.pdf`、出所は `sources.json`。記入は `official-filing-pdf.ts` の `leaveEndRemuneration`。2つの様式は同じ並びで育休は10px左）。期限は「速やかに」。
- ホーム：`home/service.ts` の `revisionTodo`。3か月目の給与の月が来るまでは「待ち」。

## 4-9. 重要な仕様（段階6 年齢到達）

- 40・65歳は届出がないため手続きを作らない。介護保険料は毎月の計算が年齢から自動で変える（前月差額の理由に「介護保険の開始・終了」が出る）。70・75歳は個人型のウィザード（`procedureType: 'age_event'` に `ageEvent` の状態。1人に1回なので、同じ種類の手続きがあれば終えたものも開く）。ステップは `AGE_WIZARD_STEPS`：到達日と届出の要否を確かめる→届出→承認→提出→完了。
- 判定 `age-event/rules.ts`（純粋関数・テストあり）：到達日＝誕生日の前日。70歳は到達日に厚生年金を喪失し、到達日の月の前月分まで。75歳は誕生日当日に健康保険を喪失し、誕生日の月の前月分まで。届出の期限は起きた日から5日。70歳は「標準報酬月額相当額」（到達日の報酬月額を厚年の等級表に当てはめる）が到達前の厚年の標準報酬月額と同じなら届出不要（様式にも「従前額と異なる場合に提出」とある）。報酬月額の目安は直近の固定的賃金＋3か月の非固定的賃金の平均で、担当者が直せる。健康保険の等級は変えない。
- 保険料の月ごとの年齢の扱いは `calculator/age.ts` の `ageFlagsForMonth`（日付で判定）に一本化し、`utils/age.ts` の `isHealthExcluded` などはその包み。以前は75歳の誕生日が月の1日の人の前月分の健保を外していた。
- サーバー `functions/src/age-event/`（us-central1）：`ageEventStart`・`ageEventGet`・`ageEventPreview`（70歳の届出の要否。保存しない）・`ageEventUpdate`（step: check／filing／complete）・`sampleAgeCreate`。届出が要らない70歳は届出のステップを `skipped` にし、完了は手続き側で閉じる。75歳は被扶養者（`dependents`）も外れることを案内し、保険証などの回収枚数を入れる。台帳（雇用条件の加入）は書き換えない（計算は年齢から判定するため）。
- 届出：75歳は `lossNotification`（喪失原因「75歳到達」→ 様式の「7.」に丸）。70歳は新しい種類 `pensionLoss70`（公式様式 `src/public/filing-forms/pension-loss-70.pdf`、出所は `sources.json`。喪失原因「6. 70歳到達」は様式に印刷済み。記入は `official-filing-pdf.ts` の `pensionLoss70`）。
- 入口：ライフイベントのカード「70歳・75歳になる」（`procedure-start.ts` で従業員と年齢を選ぶ）、ホームのやること（`/age-events/new?employeeId=&kind=` を開くと手続きを作る）。ホーム：`home/service.ts` の `ageNoticeTodos`（まだ始めていない到達）と `ageTodo`（手続き）。従業員を全員読む（`select` で生年月日などだけ）。

## 4-10. 重要な仕様（段階6 雇用条件の変更・有期雇用・二以上事業所・事業所間異動）

- 雇用条件の変更 `/employment-changes/:id`（`procedureType: 'employment_change'` に `employmentChange`）：新しい条件を入れる→承認者が雇用条件を確認する→届出→承認→提出→完了。サーバー `functions/src/employment-change/`（`employmentChangeStart`・`Get`・`Preview`・`Update`（entry／filing／complete）・`sampleChangeCreate`）。判定は入社の `evaluateContract` を新しい条件の初日で使う。保存すると `employments` に **effectiveDate を持たない下書き**（`plannedEffectiveDate`）を作り、`requestType: 'employment'` で承認を依頼する（日付で探す計算・判定から見えない）。承認されたら、次に手続きを開いたときに effectiveDate を付けて有効にし、従業員の `contract` を書き換える（`applyIfApproved`）。加入が切り替われば資格取得届（取得日＝初日、`metadata.grade` で資格取得時決定）・資格喪失届（喪失日＝初日の翌日、健康保険法第36条）。雇用条件の承認のステップは type を data_entry にしてある（approval にすると届出の承認と混ざる）。入口は従業員詳細の「雇用条件を変える」と、有期の満了の案内の「契約を更新する」（`reason: 'renewal'`）。
- 有期雇用：`createEmployment` が契約を従業員に写す（`contract: {type, endDate, renewalExpected}`）。ホームの `contractTodo`（従業員を読む `ageNoticeTodos` の中で、先月〜来月末の満了）。従業員詳細に満了の案内。
- 二以上事業所：`employeeOtherEmployerSet` で従業員に `otherEmployer` を記録（保険料・届出は変えない）。`employeeGet`・`monthlyRunOverview`（行の `otherEmployer`）・各ウィザードの取得で返し、警告を出す。
- 事業所間異動 `/transfers/:id`（`procedureType: 'transfer'` に `transfer`）：異動先と異動日→台帳の所属事業所を変える→資格喪失届・資格取得届を出す→完了。サーバー `functions/src/transfer/`（`transferStart`・`Get`・`Preview`・`Update`（entry／apply／complete））。届出は2件で、届出の画面で承認・提出し、手続きは2件とも提出済み（模擬申請の完了か紙の受理）になると次へ進む。取得届の等級は今の等級を引き継ぎ、届出の承認で異動月の等級として確定。従業員詳細の旧い異動パネル（`employeeTransfer`）はボタンから外した（関数は残る）。
- 届出の画面の模擬申請・提出記録は確認ダイアログを通るため、ブラウザーペインでは押せない（今回は関数を直接呼んで確かめた件がある）。

## 5. 現在の状態（本番）

- 段階4の関数と `homeTodos` はデプロイ済み。段階6の `resignationStart`・`resignationGet`・`resignationPreview`・`resignationUpdate`・`userUnsuspend`（今回が初公開）、扶養の `dependentChangeStart`・`dependentChangeGet`・`dependentChangePreview`・`dependentChangeUpdate`、直した `dependentList` もデプロイ済み。産休・育休の `leaveProcedureStart`・`leaveProcedureGet`・`leaveProcedurePreview`・`leaveProcedureUpdate` と、変更した `leaveList`・`homeTodos`・`filingMockSubmit`・`filingPdfData`・`monthlyJobChunk`・`monthlyInsuranceCalculate`・`bonusInsuranceCalculate` も 2026-10-29 にデプロイ済み（ただし `homeTodos` の期間の表示（「6月30日〜10月10日」の形）の直しは未デプロイ）。旧画面の `operationsMonthlyAction` は免除の変更を反映していない。認証（`middleware/auth.ts`）の変更は、これらの関数にだけ反映されている。**Hosting（画面）は未公開**（ローカルの開発サーバーで確認している）。
- 算定基礎届（2026-10-30）：`santeiRunOverview`・`santeiRunHold`・`santeiDecision`・`santeiJobStart`・`santeiJobGet`・`santeiJobChunk`（asia-northeast1）・`santeiFilingCreate`・`santeiFilingUpdate`・`santeiFilingGet`・`sampleSanteiCreate` を新規デプロイ。`homeTodos` を再デプロイ（算定基礎届のやることと、産休・育休の期間の表示の直しを含む）。
- 料率マスタ：2026-10-29 に修正済み（単位を ‰ に、協会けんぽ令和7・8年度の東京・大阪・兵庫の健保と介護を追加。修正関数 `migrateInsuranceRates`）。全国一律の厚年・拠出金は、甲子園のサンプル用の料率（2026-04〜）で決まっている（値は正しい）。
- テストデータ：
  - 本社・2026年11月支給の3名（テスト 入社太郎・岩貞 祐太・前田 翔太）は6ステップ完了。本社に別途追加された「高橋 三郎（T-11111）」は等級なしで「計算できません」。
  - 「サンプル負荷テスト事業所」（`sample-load-office`、翌月控除、300名、`sampleLoadCreate` で作成）：2026年10月・11月支給は完了。12月支給には LOAD-0001 の未承認の給与が1件だけある。給与項目マスタに「住宅手当」を追加済み。
  - 本番にユーザーが作った入社手続き「前田 翔太」（9月1日入社）が2件ある。旧方式の退職手続き「前田 翔太 退職手続き」も進行中で残っている。
  - 扶養のテスト（2026-10-29）：LOAD-0298 林 修に配偶者 林 花子（年収100万円）と子 林 太郎（2006年生まれ・年収140万円）を 2026-11-01 付けで追加し、完了まで通した（台帳に2人いる）。
  - 退職のテスト（2026-10-29、いずれも退職日 2026-11-30）：LOAD-0299 斎藤 修は完了（模擬電子申請済み。別途入金 45,000円は未記録のまま）。LOAD-0300 清水 修は等級なしのため「最後の保険料の集め方」で止まっている（等級なしの表示の確認用）。どちらも台帳は退職済み。
  - 産休・育休のテスト（2026-10-29〜30）：サンプル負荷テスト事業所に「T-LEAVE1 テスト 産休花子」（女性・2026-04-01入社・月給30万円）を入社の手続きで登録（台帳と雇用条件まで。資格取得届は未作成のため、入社の手続きは「等級を確かめて資格取得届を作る」で止まっている。毎月の処理の10月支給に要対応が1名増えた）。産休（出産予定日 2026-08-10、出産日 2026-08-15 で変更届、2026-10-10 に予定どおり終了）は完了。続けて育休（子 テスト 太郎、2026-10-11〜）を始め、2026-10-29 に早めに終えて終了届を出し、完了した（免除は2026年10月のみ）。
  - 算定基礎届のテスト（2026-10-30）：`sampleSanteiCreate` で「サンプル算定テスト事業所」（`sample-santei-office`、300名、`SANTEI-0001`〜。2026年4〜6月支給の承認済みの給与、前年9月の等級。50人ごとに除外・保留・日数不足・パート・短時間・途中入社・遡及支払・70歳以上の人）を作成。2026年の定時決定：不足の6名を従前で決定、12名を保留、270名の等級を承認（9月の等級が確定）、届出（2件目。1件目は取り消し）を承認→模擬電子申請→完了。この事業所はホームの「毎月の処理（2026年10月支給）」にも出る（給与なし294名）。
- 賞与（2026-10-30）：`bonusRunOverview`・`bonusRunHold`・`bonusRunImport`・`bonusRunEntry`・`bonusRunNonPayment`・`bonusJobStart`・`bonusJobGet`・`bonusJobChunk`（asia-northeast1）・`bonusFilingCreate`・`bonusFilingUpdate`・`bonusFilingGet`・`sampleBonusCreate` を新規デプロイ。`bonusInsuranceCalculate`・`homeTodos`・`officeList`・`officeUpdate` を再デプロイ。
- 随時改定・終了時改定（2026-10-30）：`gradeRevisionStart`・`gradeRevisionGet`・`gradeRevisionPreview`・`gradeRevisionUpdate`・`sampleRevisionCreate` を新規デプロイ。`monthlyRunOverview`・`homeTodos`・`approvalRequestApprove`・`filingMockSubmit`・`filingPdfData`・`filingCreate` を再デプロイ。`homeTodos` の期間の表示の直しも、この再デプロイより前に反映済み（別セッションで確認）。
- 年齢到達（2026-10-30）：`ageEventStart`・`ageEventGet`・`ageEventPreview`・`ageEventUpdate`・`sampleAgeCreate` を新規デプロイ。75歳の直しで `monthlyInsuranceCalculate`・`monthlyJobChunk`・`bonusInsuranceCalculate`・`bonusJobChunk`・`resignationGet`・`resignationPreview`・`resignationUpdate`・`employeeResign` を、ほかに `homeTodos`・`filingMockSubmit`・`filingPdfData`・`filingCreate` を再デプロイ。
- 雇用条件の変更など（2026-10-30）：`employmentChangeStart`・`employmentChangeGet`・`employmentChangePreview`・`employmentChangeUpdate`・`sampleChangeCreate`・`transferStart`・`transferGet`・`transferPreview`・`transferUpdate`・`employeeOtherEmployerSet` を新規デプロイ。`homeTodos`・`employeeGet`・`employmentCreate`・`onboardingUpdate`・`monthlyRunOverview`・`resignationGet`・`gradeRevisionGet`・`ageEventGet` を再デプロイ。
- 端数処理の移行（`migrateOfficeRoundingRule`）は未実行。会社設定の「特定適用事業所」は未登録（3/4未満の人の加入判定が「担当者の判断が必要」になる）。
- 賞与のテスト（2026-10-30）：`sampleBonusCreate` で「サンプル賞与テスト事業所」（`sample-bonus-office`、300名、`BONUS-0001`〜、支給予定月 7・9・12月、2026年4・7・8月の賞与つき。50人ごとに同月2回・上限に近い・上限超え・4回目・育休免除・70歳以上・喪失月・喪失日以後・支給なし・現物・7月未承認・適用外の人）を作成。12月支給を表の貼り付けで294名取り込み（1人分の入力で BONUS-0011 に2回目 100,500円を追加）、賞与額を承認、282名の保険料を計算（7月未承認の6名は失敗→保留）、276名の保険料を承認、届出（276名）を承認→模擬電子申請→完了。9月は不支給のアラートが出たまま（記録の操作は未確認）。7月の未承認6名のため、ホームに「賞与（2026年7月支給）：賞与額の承認を依頼する」が出る。この事業所はホームの「毎月の処理（2026年10月支給）」にも出る（給与なし300名）。
- 改定のテスト（2026-10-30）：`sampleRevisionCreate` で「サンプル改定テスト事業所」（`sample-revision-office`、11名 `REV-0001`〜。2025年9月の定時決定の等級、2026年6〜9月支給の給与。昇給・降給・1等級差・向き違い・日数不足・遡及・上限・下限・短時間・9月未承認・育休明け）を作成。2026年9月支給の保険料を計算（未承認）。REV-0001 の随時改定（健保22→25・厚年19→22、10月から）と REV-0011 の育休終了時改定（健保22→21・厚年19→18、10月から）は承認→模擬電子申請→完了。REV-0003 は「改定しない」で終えた。ホームに「毎月の処理（2026年9月・10月支給）」が増えている。
- 年齢到達のテスト（2026-10-30）：`sampleAgeCreate` で「サンプル年齢到達テスト事業所」（`sample-age-office`、7名 `AGE-0001`〜。40・65歳、70歳（報酬が同じ／再雇用で下がった・12月1日生まれ／10月に到達済み）、75歳（配偶者が被扶養者／11月1日生まれ）。2026年9月の等級と8〜10月支給の承認済みの給与）を作成。AGE-0003（70歳・届出なし）は完了、AGE-0004（70歳・届出あり）と AGE-0006（75歳）は承認→模擬電子申請→完了。AGE-0005（10月到達・期限切れ）と AGE-0007（75歳・11月1日生まれ）はホームのやることに残っている。この事業所はホームの「毎月の処理（2026年10月支給）」にも出る。
- 変更のテスト（2026-10-30）：`sampleChangeCreate` で「サンプル変更テスト事業所」（`sample-change-office`、東京）と「サンプル変更テスト大阪事業所」（`sample-change-office-osaka`）、6名 `CHG-0001`〜 を作成。CHG-0001 は契約を2027-11-30まで更新（完了）、CHG-0002 は11月15日満了の知らせが出たまま、CHG-0003 は12月からパート（資格喪失届を提出・完了）、CHG-0004 は12月から正社員（資格取得届を提出・完了、12月の資格取得時決定の等級）、CHG-0005 は12月1日に大阪へ異動（届出2件を提出・完了、所属は大阪）、CHG-0006 は二以上事業所（株式会社サンプル物流）を登録。CHG-0001 には、最初の保存のエラーの前に作られた余分な雇用条件の承認依頼（effectiveDate のない下書き）が1件ある（ユーザーに差し戻しを依頼）。
- テスト：593件中584件成功。失敗9件は改修前から（各テスト独自のモックが手続き機能に追随していない。段階10で対応）。

## 6. 次にやるべきタスク

1. **段階6 退職の任意の確認**：紙の提出・差し戻しの表示、アカウントのある人での閲覧専用・ログイン停止、70歳・75歳・外国人の人（いずれも該当するテストデータがない）。
2. **段階6の残り**：チェックリストで段階6が担当の 🟡・🔵 のうち画面での確認が足りない項目（外国人の退職案内、閲覧期間・アカウント停止、免除の計算結果、扶養の非該当・変更、⑪、等級履歴から届出を開く）を確かめる。そのあと段階7（届出・承認の横断機能）。年齢到達の任意の確認：紙の提出・差し戻し、退職の画面で70歳・75歳の人を通す、毎月の処理で75歳の月初生まれの保険料（10月分まで健保）を計算して確かめる。随時改定・終了時改定の任意の確認：産休・育休の完了画面から始める流れ（休業の引き継ぎ）と産休終了時の改定（⑪の画面確認）、下限の特例で従前の報酬月額を入れて判定する操作、紙の提出・差し戻し、改定した月の保険料の計算し直しの案内、毎月の処理で手続きを始めた後の表示。賞与の任意の確認：不支給報告書の提出日の記録と取り消し、紙の提出・届出や賞与額の差し戻し後の出し直し、承認者だけのアカウントでのホーム表示、7月の未承認6名を承認して12月を計算し直す流れ（年度累計が変わり「計算し直し」になる）。算定基礎届の任意の確認：9月分の保険料に新しい等級が使われること（毎月の処理）、紙の提出・届出の差し戻し・等級の差し戻し後の出し直し、承認者だけのアカウントでのホーム表示。扶養の任意の確認：非該当・変更・紙の提出、入社から引き継ぐ流れ。産休・育休の任意の確認：紙の提出・差し戻し、産休の終了届（判定は単体テストのみ）、育休の延長の提出（判定は画面で確認）、免除が毎月の計算結果に出ること（テスト用の人に給与がないため未確認）。
3. **産休・育休の残り**：ウィザードの読み込みが10〜15秒かかることがある（新しい関数の初回起動。速さの判断とあわせて見る）。
4. **速さの判断（ユーザーに確認）**：ホーム約5秒、毎月の処理の状況5〜6.5秒、承認一覧約8秒（関数が us-central1・Firestore が東京のため）。読み込みの多い関数を asia-northeast1 に移す案（画面の呼び出し先の変更も必要）。
5. 任意の確認：承認者だけのアカウントでのホーム表示（段階5）。料率が変わったときの「計算し直しが必要」、差し戻しの表示、ポータルの明細（段階4）。いずれも別アカウントが要る。
6. 以前からの残り：認証の変更を全関数に反映する再デプロイ（承認要）、端数処理の移行の実行（承認要）、入社の差し戻し・返戻の画面確認、特定適用事業所の登録（ユーザーに確認）、Hosting の公開（承認要）、サンプルデータの等級の修正。
7. 以降は `docs/roadmap.md` の段階7〜10。後続課題は `docs/catalog-checklist.md` の末尾。

### 段階6の着手メモ

- **順番**（ロードマップ）：退職（済み）→ 扶養（済み） → 産休・育休（済み） → 算定基礎届（済み） → 賞与（済み） → 随時改定・終了時改定（済み） → 年齢到達（済み）。業務ごとに「データ→計算→画面→一括操作→実ブラウザー確認」を終え、チェックリストを埋めてから次へ進む。
- **型**：退職・扶養・産休育休・随時改定・年齢到達は個人型（入社のウィザード `features/onboarding/onboarding-wizard.ts` ＋ `functions/src/onboarding/` が見本）。算定基礎届・賞与は一括型（毎月の処理 `features/monthly/` ＋ `functions/src/monthly/` が見本。賞与は `features/bonus/` ＋ `functions/src/bonus/`）。
- **入口**：ライフイベントのカード `features/procedures/life-events.ts`。休業・異動は今 `procedure-start.ts` で従業員を選び、従業員詳細 `/employees/:id?action=<種類>` へ移る。退職・扶養は `start()` の `wizard` の表でウィザードへ移る（見本にする）。随時改定は `/employees/:id/revision`。ウィザードができたら、`procedure-start.ts` の `start()` で行き先を変える。
- **退職の作り（見本）**：上の「4-3」を参照。画面は `features/resignation/`（入社のウィザードのスタイルを共用）。旧方式の `employeeResign`／`createLossProcedure`／`LOSS_STEPS` は画面から使っていない。
- **ホーム**：ウィザードを作った業務は `home/service.ts` の `wizardTodo` を使い、`procedureTodos` の振り分けに1行足す（退職・扶養と同じ）。`home/rules.ts` と画面の `dashboard.ts` の `kind` にも種類を足す。

## 7. 作業上の注意

- **本番への書き込み・デプロイ・Hosting の公開は事前にユーザーに確認する。** 本番の認証にパスワードを入力しない。承認の確認には別アカウントが要る（ユーザーが操作）。
- **デプロイ**は PowerShell から関数名を明示して行う（Bash からは firebase CLI が動かない）：
  `firebase deploy --only functions:default:<名前>,functions:default:<名前> --project kensyu10171 --non-interactive`
  全体デプロイはしない（未公開の関数が13個あり、個人番号が平文のものを含む）。別 codebase `socialinsurance` に触れない。
- **Firestore の索引**：`firestore.indexes.json` は本番より古い。索引のデプロイは本番の定義と合わせ、明示の承認を得る。新しい処理は複合索引に頼らない形にしている。
- Firestore のトランザクションでは書き込みの前にすべて読み取る。監査ログなどに `undefined` を書かない（書き込みが失敗する）。
- ビルドとテスト：`functions` で `npx tsc --noEmit -p .` と `npx jest --config jest.config.js`、`src` で `npx ng build --configuration development`（以前からの警告 NG8011 が出る）。
- 開発サーバー：`.claude/launch.json` の `angular-dev`（本番の Firebase に接続。ポートが埋まっていると 4203 などになり、ログインし直しが必要）。
- 画面確認の注意：ブラウザーペインの日本語の自動入力は Angular に伝わらないことがある（`form_input` を使う）。`window.confirm` はペインで押せない。共通部品を変えると開発サーバーが画面を読み込み直し、画面内の状態が消える。数値の入力欄（`ngModel` の type=number）は `form_input` が伝わらないので、クリックして `type` で打つ。表示幅の設定はターンごとに戻る。PDFのプレビュー（iframe の中）はクリックできないため、記入位置を見るときは JS で iframe を `position: fixed` にし、`src` に `#page=1&zoom=200,左,上` を付けて読み込み直す。
- 一部のファイルは改行が CRLF になっている。スクリプトで置換するより Edit ツールを使う。

## 8. 関連文書

| 文書 | 内容 |
|---|---|
| `docs/roadmap.md` | 段階0〜10の手順と終わりの条件（正） |
| `docs/catalog-checklist.md` | カタログ各項目の状態と担当段階、後続課題 |
| `docs/catalog-gap-analysis.md` | 初回の乖離分析（段階1以前） |
| `docs/ux-one-way-plan.md` | 一本道UI・大人数対応の方針 |
| `docs/screen-restructure-*.md`、`work/*.md` | 旧計画・旧引継ぎ（参考のみ） |
