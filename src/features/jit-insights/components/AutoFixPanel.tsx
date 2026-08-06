import { useMemo, useState, useCallback } from 'react';
import { fixSourceForFindings, applySourcePatches } from '../../../shared/engine';
import type { JitFinding, JitFix, JitPatch } from '../../../shared/types';
import { FileUpload } from '../../../shared/components';
import { useI18n } from '../../../shared/i18n/useI18n';

interface Props {
  findings: JitFinding[];
}

function strategyLabel(strategy: JitPatch['strategy'], t: (k: string) => string): string {
  return t(`jitFix.strategy.${strategy}`);
}

function ResolutionBadge({ fix }: { fix: JitFix }) {
  const { t } = useI18n();
  if (fix.missingSource) return <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">{t('jitFix.unresolved')}</span>;
  if (fix.scope === 'function') return <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{fix.functionName}</span>;
  return <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{t('jitFix.scopeFile')}</span>;
}

export function AutoFixPanel({ findings }: Props) {
  const { t } = useI18n();
  const [files, setFiles] = useState<{ name: string; code: string }[]>([]);
  const [appliedByFile, setAppliedByFile] = useState<Record<string, JitPatch[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fixes = useMemo(() => fixSourceForFindings(files, findings), [files, findings]);

  function addFile(file: File) {
    file.text().then(content => {
      setFiles(prev => {
        const next = prev.filter(f => f.name !== file.name);
        return [...next, { name: file.name, code: content }];
      });
    });
  }

  function clearFiles() {
    setFiles([]);
    setAppliedByFile({});
  }

  function applyFix(fix: JitFix) {
    if (!fix.patches.length || !fix.filename) return;
    setAppliedByFile(cur => ({
      ...cur,
      [fix.filename!]: [...(cur[fix.filename!] ?? []), ...fix.patches],
    }));
  }

  function revertFile(filename: string) {
    setAppliedByFile(cur => {
      const next = { ...cur };
      delete next[filename];
      return next;
    });
  }

  function download(filename: string) {
    const original = files.find(f => f.name === filename)!.code;
    const fixed = applySourcePatches(original, appliedByFile[filename] ?? []);
    const blob = new Blob([fixed], { type: 'text/javascript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename.replace(/\.[^.]*$/, '')}.fixed.js`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      {/* Left: source files */}
      <div className="lg:col-span-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">{t('jitFix.sourceFiles')}</h3>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">{t('jitFix.sourceHint')}</p>
        <div className="mb-2">
          <FileUpload
            onFile={addFile}
            accept=".js,.jsx,.ts,.tsx,.cjs,.mjs,.txt,.log"
            label={t('jitFix.sourceFiles')}
            fileName={files.length > 0 ? files[files.length - 1].name : null}
            onReset={clearFiles}
          />
        </div>
        {files.length === 0 ? (
          <div className="p-3 text-xs text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-900 rounded-md">{t('jitFix.noSource')}</div>
        ) : (
          <div className="space-y-2">
            {files.map(f => {
              const applied = appliedByFile[f.name] ?? [];
              const fixed = applySourcePatches(f.code, applied);
              const changed = fixed !== f.code;
              return (
                <div key={f.name} className="border border-gray-200 dark:border-gray-700 rounded-md overflow-hidden">
                  <div className="px-2 py-1.5 flex items-center justify-between gap-2 bg-gray-50 dark:bg-gray-900">
                    <span className="text-xs font-mono text-gray-700 dark:text-gray-200 truncate">{f.name}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {changed && <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">{t('jitFix.changed')}</span>}
                      {applied.length > 0 ? (
                        <>
                          <button onClick={() => revertFile(f.name)} className="text-[10px] text-rose-500 hover:text-rose-600">{t('jitFix.revert')}</button>
                          <button onClick={() => download(f.name)} className="text-[10px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{t('jitFix.download')}</button>
                        </>
                      ) : (
                        <span className="text-[10px] text-gray-400">{t('jitFix.untouched')}</span>
                      )}
                    </div>
                  </div>
                  {changed && (
                    <details>
                      <summary className="px-2 py-1 text-[10px] text-indigo-600 dark:text-indigo-400 cursor-pointer">{t('jitFix.preview')}</summary>
                      <pre className="whitespace-pre-wrap font-mono text-[10px] bg-gray-50 dark:bg-gray-900 p-2 text-gray-600 dark:text-gray-300">{fixed}</pre>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right: findings -> fixes */}
      <div className="lg:col-span-3 space-y-3 max-h-[640px] overflow-y-auto pr-1">
        {findings.length === 0 ? (
          <div className="p-6 text-sm text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">{t('jitFix.noFindings')}</div>
        ) : (
          fixes.map(fix => {
            const alreadyApplied = fix.filename ? (appliedByFile[fix.filename] ?? []).length > 0 : false;
            return (
              <div key={fix.findingId} className={`bg-white dark:bg-gray-800 border rounded-lg overflow-hidden ${selectedId === fix.findingId ? 'border-indigo-400 dark:border-indigo-600' : 'border-gray-200 dark:border-gray-700'}`}>
                <div className="px-3 py-2 flex items-center justify-between gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800" onClick={() => setSelectedId(selectedId === fix.findingId ? null : fix.findingId)}>
                  <div className="min-w-0">
                    <h4 className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">{t(`jitFinding.rule.${fix.rule}`)}</h4>
                    <div className="text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate">{fix.target}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <ResolutionBadge fix={fix} />
                    {fix.patches.length > 0 && (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                        {fix.patches.length} {t('jitFix.patches')}
                      </span>
                    )}
                  </div>
                </div>
                {selectedId === fix.findingId && (
                  <div className="px-3 pb-3 space-y-3 border-t border-gray-100 dark:border-gray-800 pt-3">
                    {fix.missingSource && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">{t('jitFix.missingSource').replace('{target}', fix.target)}</p>
                    )}
                    {!fix.missingSource && fix.patches.length === 0 && (
                      <p className="text-xs text-gray-400 dark:text-gray-500">{t('jitFix.cleanFunction')}</p>
                    )}
                    {fix.scope === 'function' && !fix.missingSource && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t('jitFix.scopedTo').replace('{file}', fix.filename ?? '').replace('{fn}', fix.functionName ?? '')}
                      </p>
                    )}
                    <button
                      onClick={() => applyFix(fix)}
                      disabled={fix.missingSource || fix.patches.length === 0 || alreadyApplied}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg ${fix.missingSource || fix.patches.length === 0 ? 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500 cursor-not-allowed' : alreadyApplied ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 cursor-default' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                    >
                      {alreadyApplied ? t('jitFix.applied') : t('jitFix.apply')}
                    </button>
                    {fix.patches.map(p => (
                      <div key={p.id} className="grid grid-cols-2 gap-px bg-gray-100 dark:bg-gray-700 rounded overflow-hidden">
                        <div>
                          <div className="px-2 py-0.5 text-[9px] font-medium text-gray-400 uppercase bg-gray-50 dark:bg-gray-900">{strategyLabel(p.strategy, t)}</div>
                          <pre className="px-2 py-1 font-mono text-[10px] text-gray-700 dark:text-gray-200 overflow-x-auto whitespace-pre-wrap line-through opacity-60">{p.before}</pre>
                        </div>
                        <div>
                          <div className="px-2 py-0.5 text-[9px] font-medium text-emerald-600 dark:text-emerald-400 uppercase bg-gray-50 dark:bg-gray-900">{p.equivalence.passed ? t('jitFix.equivalent') : t('jitFix.notEquivalent')}</div>
                          <pre className="px-2 py-1 font-mono text-[10px] text-emerald-800 dark:text-emerald-200 overflow-x-auto whitespace-pre-wrap">{p.after}</pre>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

