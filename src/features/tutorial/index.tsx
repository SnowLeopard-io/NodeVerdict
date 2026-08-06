import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import tutorialMd from './TUTORIAL.md?raw';
import tutorialMdZh from './TUTORIAL.zh.md?raw';
import { useI18n } from '../../shared/i18n/useI18n';
import { Page } from '../../shared/components';

export function TutorialPage() {
  const { t, lang } = useI18n();
  const content = lang === 'zh' ? tutorialMdZh : tutorialMd;
  return (
    <Page>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('tutorial.title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('tutorial.description')}</p>
      </div>
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => (
              <h1 className="text-xl font-bold mb-4 mt-2 text-gray-900 dark:text-gray-100">{children}</h1>
            ),
            h2: ({ children }) => (
              <h2 className="text-lg font-semibold mb-3 mt-5 text-gray-900 dark:text-gray-100">{children}</h2>
            ),
            h3: ({ children }) => (
              <h3 className="text-base font-semibold mb-2 mt-4 text-gray-900 dark:text-gray-100">{children}</h3>
            ),
            h4: ({ children }) => (
              <h4 className="text-sm font-semibold mb-2 mt-3 text-gray-900 dark:text-gray-100">{children}</h4>
            ),
            p: ({ children }) => (
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mb-3">{children}</p>
            ),
            hr: () => <hr className="my-6 border-gray-200 dark:border-gray-700" />,
            ul: ({ children }) => (
              <ul className="mb-3 space-y-1 ml-5 list-disc text-sm text-gray-700 dark:text-gray-300">{children}</ul>
            ),
            ol: ({ children }) => (
              <ol className="mb-3 space-y-1 ml-5 list-decimal text-sm text-gray-700 dark:text-gray-300">{children}</ol>
            ),
            li: ({ children }) => <li className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">{children}</li>,
            code: ({ className, children, ...props }) => {
              const isInline = !className;
              if (isInline) {
                return (
                  <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-900 rounded text-xs font-mono text-indigo-600 dark:text-indigo-400" {...props}>
                    {children}
                  </code>
                );
              }
              return (
                <pre className="mb-3 p-3 bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-x-auto text-xs leading-relaxed">
                  <code className={`${className ?? ''} text-gray-800 dark:text-gray-200`} {...props}>{children}</code>
                </pre>
              );
            },
            pre: ({ children }) => <>{children}</>,
            table: ({ children }) => (
              <div className="mb-3 overflow-x-auto">
                <table className="w-full border-collapse border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden text-sm">
                  {children}
                </table>
              </div>
            ),
            thead: ({ children }) => (
              <thead className="bg-gray-50 dark:bg-gray-800">{children}</thead>
            ),
            th: ({ children }) => (
              <th className="px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400 text-left border-b border-gray-200 dark:border-gray-700">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
                {children}
              </td>
            ),
            tr: ({ children }) => (
              <tr className="border-b border-gray-200 dark:border-gray-700 last:border-b-0">{children}</tr>
            ),
            strong: ({ children }) => (
              <strong className="font-semibold text-gray-900 dark:text-gray-100">{children}</strong>
            ),
            a: ({ href, children }) => (
              <a href={href} className="text-indigo-600 dark:text-indigo-400 hover:underline">{children}</a>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </Page>
  );
}