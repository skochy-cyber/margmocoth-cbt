const H = require('./harness');
const { t, ok, seed, post, sweep, fail, DB, OID, results, mails } = H;
const old = d => new Date(Date.now() - d * 60 * 1000);

(async () => {
  await t('1. happy path, shuffled answers scored against per-student map', async () => {
    const s = seed({ nq: 4 });
    const r = await post(s.body());
    ok('success', r.success === true, r);
    ok('4/4 correct using shuffled map (DB answer is A, map differs)', r.result.correct === 4 && r.result.percentage === 100, r.result);
    ok('exactly one result row', results().length === 1);
    ok('session marked submitted', s.sess.status === 'submitted' && !!s.sess.submitted_at);
    ok('review saved', DB.ExamReview.rows.length === 1);
  });

  await t('2. wrong / blank answers', async () => {
    const s = seed({ nq: 4 });
    const a = { ...s.allRight }; const ids = Object.keys(a);
    a[ids[0]] = 'D'; delete a[ids[1]];
    const r = await post(s.body({ answers: a }));
    ok('2 correct, 2 wrong', r.result.correct === 2 && r.result.wrong === 2 && r.result.percentage === 50, r.result);
  });

  await t('3. lost response -> client retries -> no duplicate result', async () => {
    const s = seed();
    const r1 = await post(s.body()); const r2 = await post(s.body()); const r3 = await post(s.body());
    ok('all succeed', r1.success && r2.success && r3.success);
    ok('still one result', results().length === 1, results().length);
    ok('same result_id returned', r1.result.result_id === r2.result.result_id && r2.result.result_id === r3.result.result_id);
  });

  await t('4. concurrent double submit (double click / two tabs)', async () => {
    const s = seed();
    const [a, b] = await Promise.all([post(s.body()), post(s.body())]);
    const wins = [a, b].filter(x => x.success).length, retry = [a, b].filter(x => x.retryable && !x.success).length;
    ok('one result row only', results().length === 1, results().length);
    ok('one wins, other told to retry (or both resolve to the same result)', (wins === 1 && retry === 1) || (wins === 2 && a.result.result_id === b.result.result_id), { a, b });
  });

  await t('5. FORCED FAILURE: ExamResult.create throws -> answers kept, client told to retry', async () => {
    const s = seed();
    fail['ExamResult.create'] = 1;
    const r = await post(s.body());
    ok('success:false + retryable:true', r.success === false && r.retryable === true, r);
    ok('no result created', results().length === 0);
    ok('answers persisted on session before scoring', Object.keys(s.sess.answers).length === 4);
    ok('submit_requested flag set', s.sess.submit_requested === true);
    ok('session still active (not falsely submitted)', s.sess.status === 'active');
    ok('submit lock released (retry not blocked)', H.ctx.submitLocks.size === 0, [...H.ctx.submitLocks]);
    const r2 = await post(s.body());
    ok('client retry now succeeds, 4/4', r2.success && r2.result.correct === 4, r2);
    ok('exactly one result', results().length === 1);
  });

  await t('6. FORCED FAILURE: server never gets a retry -> recovery sweep scores from stored answers', async () => {
    const s = seed();
    fail['ExamResult.create'] = 1;
    await post(s.body());
    await sweep();
    ok('sweep ignores it while younger than 2 minutes', results().length === 0);
    s.sess.submit_requested_at = old(5);
    await sweep();
    ok('sweep created the result', results().length === 1, results().length);
    ok('scored correctly from stored answers (4/4)', results()[0]?.correct === 4, results()[0]);
    ok('session submitted', s.sess.status === 'submitted');
    await sweep();
    ok('sweep is idempotent', results().length === 1);
    const r = await post(s.body());
    ok('late client retry returns same result, no duplicate', r.success && results().length === 1);
  });

  await t('7. FORCED FAILURE: result saved but session status update fails', async () => {
    const s = seed();
    fail['ExamSession.findByIdAndUpdate'] = 1;
    const r = await post(s.body());
    ok('request reports failure/retry (result row exists though)', r.success === false && results().length === 1, { r, n: results().length });
    ok('session left active', s.sess.status === 'active');
    const r2 = await post(s.body());
    ok('retry returns existing result and flips status', r2.success && s.sess.status === 'submitted' && results().length === 1, { r2, st: s.sess.status });
  });

  await t('7b. same failure, but recovered by sweep instead of client', async () => {
    const s = seed();
    fail['ExamSession.findByIdAndUpdate'] = 1;
    await post(s.body());
    s.sess.submit_requested_at = old(5);
    await sweep();
    ok('no duplicate, status fixed', results().length === 1 && s.sess.status === 'submitted', { n: results().length, st: s.sess.status });
  });

  await t('8. FORCED FAILURE: ExamReview save fails -> result still returned', async () => {
    const s = seed();
    fail['ExamReview.create'] = 1;
    const r = await post(s.body());
    ok('success true', r.success === true, r);
    ok('result saved, session submitted', results().length === 1 && s.sess.status === 'submitted');
  });

  await t('9. FORCED FAILURE: DB down for the whole request', async () => {
    const s = seed();
    fail['ExamResult.findOne'] = Infinity;
    const r = await post(s.body());
    ok('retryable failure, no crash', r.success === false && r.retryable === true, r);
    ok('lock released', H.ctx.submitLocks.size === 0);
    ok('no result written', results().length === 0);
  });

  await t('10. FORCED FAILURE: first answers write fails (nothing persisted)', async () => {
    const s = seed();
    fail['ExamSession.updateOne'] = 1;
    const r = await post(s.body());
    ok('retryable', r.success === false && r.retryable === true, r);
    ok('no result, session untouched', results().length === 0 && s.sess.submit_requested === false);
    const r2 = await post(s.body());
    ok('retry succeeds', r2.success === true && results().length === 1);
  });

  await t('11. FORCED FAILURE: result email throws -> must not break submit', async () => {
    const s = seed(); DB.Setting.rows.push({ _id: OID.gen(), key: 'show_results', value: true });
    H.ctx.sendMail = async () => { throw new Error('smtp down'); };
    const r = await post(s.body());
    ok('success despite mail failure', r.success === true, r);
    H.ctx.sendMail = async m => { mails.push(m); };
  });

  await t('12. empty answers in body -> falls back to autosaved answers', async () => {
    const s = seed(); s.sess.answers = { ...s.allRight };
    const r = await post(s.body({ answers: {} }));
    ok('scored from autosave 4/4', r.success && r.result.correct === 4, r);
  });
  await t('12b. empty answers and no autosave -> 0 score, still recorded', async () => {
    const s = seed();
    const r = await post(s.body({ answers: {} }));
    ok('0/4 recorded', r.success && r.result.correct === 0 && r.result.total === 4, r);
  });
  await t('12c. answers omitted entirely', async () => {
    const s = seed(); const b = s.body(); delete b.answers;
    const r = await post(b);
    ok('no crash', r && (r.success === true || r.retryable === true), r);
  });

  await t('13. no shuffled map (legacy session) -> scored against DB answer', async () => {
    const s = seed({ shuffled: false });
    const r = await post(s.body());
    ok('4/4 vs q.answer', r.success && r.result.correct === 4, r);
  });

  await t('14. partial map: only served questions counted', async () => {
    const s = seed({ nq: 6 });
    const keep = s.qs.slice(0, 3).map(q => String(q._id));
    for (const k of Object.keys(s.sess.shuffled_answer_map)) if (!keep.includes(k)) delete s.sess.shuffled_answer_map[k];
    const a = {}; keep.forEach(k => a[k] = s.sess.shuffled_answer_map[k]);
    const r = await post(s.body({ answers: a }));
    ok('total 3, correct 3', r.success && r.result.total === 3 && r.result.correct === 3, r.result);
  });

  await t('15. ZERO-QUESTION exam', async () => {
    const s = seed({ nq: 0, shuffled: false });
    const r = await post(s.body({ answers: {} }));
    ok('no divide-by-zero NaN', r.success && r.result.percentage === 0, r);
  });

  await t('16. ABUSE / BAD INPUT: invalid ids', async () => {
    const s = seed();
    const pre = results().length;
    const r = await post({ session_id: 'garbage', student_id: 'x', exam_id: 'y', answers: s.allRight });
    ok('does not create a result for garbage ids', results().length === pre, { n: results().length, r });
    ok('returns a clean failure', r && r.success === false, r);
  });
  await t('16b. ABUSE: missing session_id must not return another student\'s result', async () => {
    const victim = seed(); await post(victim.body());               // a normal result exists
    DB.ExamResult.rows.push({ _id: OID.gen(), student_id: OID.gen(), exam_id: OID.gen(), total: 10, correct: 10, wrong: 0, percentage: 100 }); // legacy row with no session_id
    const s2 = seed();
    const r = await post({ student_id: String(s2.student._id), exam_id: String(s2.exam._id), answers: s2.allRight });
    ok('no result leaked from a row lacking session_id', !(r.success && r.result && r.result.percentage === 100 && r.result.total === 10), r);
  });
  await t('16c. ABUSE: nonexistent (but well-formed) session id', async () => {
    const s = seed(); const pre = results().length;
    const r = await post(s.body({ session_id: String(OID.gen()) }));
    ok('no orphan result created for a session that does not exist', results().length === pre, { n: results().length, r });
  });
  await t('16d. ABUSE: session belongs to a different student', async () => {
    const s = seed(); const other = seed(); const pre = results().length;
    const r = await post(s.body({ student_id: String(other.student._id) }));
    ok('rejects student_id that does not own the session', !(r.success && results().length > pre), { r, n: results().length });
  });
  await t('16e. ABUSE: exam_id differs from the session\'s exam', async () => {
    const s = seed(); const other = seed(); const pre = results().length;
    const r = await post(s.body({ exam_id: String(other.exam._id) }));
    const bad = results().length > pre && results().at(-1).exam_id && String(results().at(-1).exam_id) !== String(s.sess.exam_id);
    ok('result is not filed against a different exam than the session', !bad, { r, filed: results().at(-1) && String(results().at(-1).exam_id) });
  });
  await t('16f. ABUSE: answers is a string / array', async () => {
    const s = seed();
    const r = await post(s.body({ answers: 'ABCD' }));
    ok('no crash', r && typeof r === 'object', r);
  });

  await t('17. resubmit after already submitted (answers changed) does not rescore', async () => {
    const s = seed(); await post(s.body());
    const r = await post(s.body({ answers: {} }));
    ok('result unchanged', r.success && r.result.correct === 4 && results().length === 1, r);
  });

  process.exitCode = H.summary() ? 1 : 0;
})();
