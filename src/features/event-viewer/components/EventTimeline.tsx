import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import type { TracingEvent } from '../../../shared/types';
import { formatTimestamp, channelColor, eventTypeColor, truncate } from '../../../shared/utils';
import { useI18n } from '../../../shared/i18n/useI18n';

interface EventTimelineProps {
  events: TracingEvent[];
  selectedIndex: number | null;
  onSelect: (idx: number) => void;
}

const ROW_HEIGHT = 44;
const OVERSCAN = 10;

export function EventTimeline({ events, selectedIndex, onSelect }: EventTimelineProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewportH(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop);
  }, []);

  const { start, end } = useMemo(() => {
    const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(events.length, Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + OVERSCAN);
    return { start: first, end: last };
  }, [scrollTop, viewportH, events.length]);

  const visible = useMemo(() => events.slice(start, end), [events, start, end]);

  if (events.length === 0) {
    return <div className="text-sm text-gray-400 text-center py-8">{t('eventViewer.noEvents')}</div>;
  }

  const maxTime = events[events.length - 1]?.timestamp ?? 0;
  const minTime = events[0]?.timestamp ?? 0;
  const range = Math.max(maxTime - minTime, 1);

  const headerCell = 'px-4 py-2 font-medium text-gray-500 dark:text-gray-400 text-left';
  const header = (
    <div
      className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 grid items-center"
      style={{ gridTemplateColumns: '1.1fr 1.6fr 1.4fr 3fr 5rem' }}
    >
      <div className={headerCell}>{t('eventViewer.timestamp')}</div>
      <div className={headerCell}>{t('eventViewer.channel')}</div>
      <div className={headerCell}>{t('eventViewer.type')}</div>
      <div className={headerCell}>{t('eventViewer.context')}</div>
      <div className={`${headerCell} w-24`}>{t('eventViewer.timeline')}</div>
    </div>
  );

  return (
    <div
      className="overflow-hidden border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
    >
      {header}
      <div ref={scrollRef} onScroll={onScroll} className="overflow-auto" style={{ maxHeight: '70vh' }}>
        <div style={{ height: events.length * ROW_HEIGHT, position: 'relative' }}>
          {visible.map((event, i) => {
            const idx = start + i;
            const row = (
              <>
                <div className="px-4 font-mono text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap truncate">
                  {formatTimestamp(event.timestamp)}
                </div>
                <div className="px-4">
                  <span
                    className="inline-block px-2 py-0.5 rounded text-xs font-medium text-white max-w-full truncate"
                    style={{ backgroundColor: channelColor(event.channel) }}
                  >
                    {event.channel}
                  </span>
                </div>
                <div className="px-4">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${eventTypeColor(event.eventType)}`}>
                    {event.eventType}
                  </span>
                </div>
                <div className="px-4 text-xs text-gray-600 dark:text-gray-300 max-w-full truncate">
                  {truncate(JSON.stringify(event.context), 60)}
                </div>
                <div className="px-4 flex items-center">
                  <div className="relative h-4 w-20 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="absolute top-0 h-full rounded-full opacity-70"
                      style={{
                        left: `${((event.timestamp - minTime) / range) * 100}%`,
                        width: '4px',
                        backgroundColor: channelColor(event.channel),
                      }}
                    />
                  </div>
                </div>
              </>);
            return (
              <div
                key={idx}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(idx)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(idx); } }}
                className={`absolute left-0 right-0 grid items-center border-b border-gray-100 dark:border-gray-800 cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 ${
                  selectedIndex === idx ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800' : ''
                }`}
                style={{ top: idx * ROW_HEIGHT, height: ROW_HEIGHT, gridTemplateColumns: '1fr 1.6fr 1.4fr 3fr 5rem' }}
              >
                {row}
              </div>
            );
          })}
        </div>
      </div>
      <div className="border-t border-gray-200 dark:border-gray-700 px-3 py-1 text-xs text-gray-400">
        {t('eventViewer.rowCount').replace('{count}', String(events.length))}
      </div>
    </div>
  );
}