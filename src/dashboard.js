
export const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',

  // Foreground
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',

  // Backgrounds
  bgGreen: '\x1b[42;30;1m',
  bgYellow: '\x1b[43;30;1m',
  bgCyan: '\x1b[46;30;1m',
  bgMagenta: '\x1b[45;37;1m',
  bgRed: '\x1b[41;37;1m',
  bgGray: '\x1b[100;37m',
  bgBlue: '\x1b[44;37;1m',
  bgDark: '\x1b[48;5;236m',

  // Screen control
  altScreen: '\x1b[?1049h',
  exitAltScreen: '\x1b[?1049l',
  clear: '\x1b[2J',
  home: '\x1b[H',
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h'
};

export function stripAnsi(str) {
  return String(str).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

export function visualWidth(str) {
  return stripAnsi(str).length;
}

export function padRight(str, targetWidth) {
  const diff = targetWidth - visualWidth(str);
  if (diff <= 0) return str;
  return str + ' '.repeat(diff);
}

export function padLeft(str, targetWidth) {
  const diff = targetWidth - visualWidth(str);
  if (diff <= 0) return str;
  return ' '.repeat(diff) + str;
}

import { MetricsCollector } from './metrics.js';

export class ProxyTelemetry extends MetricsCollector {
  constructor(options = {}) {
    super(options);
  }

  renderGauge(percent, width = 16) {
    const filledCount = Math.min(width, Math.max(0, Math.round((percent / 100) * width)));
    const emptyCount = width - filledCount;

    let barColor = ANSI.brightGreen;
    if (percent < 30) barColor = ANSI.red;
    else if (percent < 70) barColor = ANSI.yellow;

    return `[${barColor}${'■'.repeat(filledCount)}${ANSI.gray}${'·'.repeat(emptyCount)}${ANSI.reset}]`;
  }

  formatBadge(signal) {
    const sig = String(signal).toUpperCase();
    if (sig === 'HIT') return `${ANSI.bgGreen}  HIT   ${ANSI.reset}`;
    if (sig === 'MISS') return `${ANSI.bgYellow}  MISS  ${ANSI.reset}`;
    if (sig === 'REPLAY') return `${ANSI.bgCyan} REPLAY ${ANSI.reset}`;
    if (sig === 'RECORD') return `${ANSI.bgMagenta} RECORD ${ANSI.reset}`;
    if (sig === 'REVALIDATED') return `${ANSI.bgCyan} REVAL  ${ANSI.reset}`;
    if (sig.includes('OVERRIDE')) return `${ANSI.bgRed} OVERRD ${ANSI.reset}`;
    if (sig.includes('FLAKE')) return `${ANSI.bgRed} FLAKE  ${ANSI.reset}`;
    if (sig.includes('CHAOS')) return `${ANSI.bgRed} CHAOS  ${ANSI.reset}`;
    if (sig === 'BYPASS') return `${ANSI.bgGray} BYPASS ${ANSI.reset}`;
    return `${ANSI.bgBlue} DIRECT ${ANSI.reset}`;
  }

  formatStatus(status) {
    const s = String(status);
    if (s.startsWith('2')) return `${ANSI.green}${s} OK  ${ANSI.reset}`;
    if (s === '304') return `${ANSI.brightCyan}304 REVL${ANSI.reset}`;
    if (s.startsWith('3')) return `${ANSI.cyan}${s} REDR${ANSI.reset}`;
    if (s === '429') return `${ANSI.brightYellow}429 TLMT${ANSI.reset}`;
    if (s.startsWith('4')) return `${ANSI.yellow}${s} CLNT${ANSI.reset}`;
    if (s.startsWith('5')) return `${ANSI.red}${s} SERV${ANSI.reset}`;
    return `${ANSI.gray}${s}     ${ANSI.reset}`;
  }

  formatDuration(ms) {
    const formatted = `${ms}ms`;
    if (ms < 10) return `${ANSI.brightGreen}${padLeft(formatted, 8)}${ANSI.reset}`;
    if (ms < 100) return `${ANSI.yellow}${padLeft(formatted, 8)}${ANSI.reset}`;
    return `${ANSI.red}${padLeft(formatted, 8)}${ANSI.reset}`;
  }

  formatMethod(method) {
    const m = method.padEnd(6);
    if (method === 'GET') return `${ANSI.cyan}${m}${ANSI.reset}`;
    if (method === 'POST') return `${ANSI.brightYellow}${m}${ANSI.reset}`;
    if (method === 'PUT') return `${ANSI.yellow}${m}${ANSI.reset}`;
    if (method === 'DELETE') return `${ANSI.red}${m}${ANSI.reset}`;
    return `${ANSI.white}${m}${ANSI.reset}`;
  }

  boxRow(content, innerWidth = 80) {
    const vWidth = visualWidth(content);
    const padding = Math.max(0, innerWidth - vWidth);
    return `${ANSI.cyan}│${ANSI.reset} ${content}${' '.repeat(padding - 1)}${ANSI.cyan}│${ANSI.reset}`;
  }

  render() {
    const innerWidth = 80;
    const hitRatioStr = this.getHitRatio();
    const hitRatioNum = this.getHitRatioNumeric();
    const gauge = this.renderGauge(hitRatioNum, 14);
    const uptime = this.getUptime();
    const avgLatency = this.getAvgLatency();
    const originLabel = this.origin || 'OFFLINE (VCR)';
    const truncatedOrigin = originLabel.length > 25 ? originLabel.slice(0, 22) + '...' : originLabel;
    const modeUpper = (this.mode || 'CACHE').toUpperCase();

    const topBorder = `${ANSI.cyan}┌${'─'.repeat(innerWidth)}┐${ANSI.reset}`;
    const midBorder = `${ANSI.cyan}├${'─'.repeat(innerWidth)}┤${ANSI.reset}`;
    const subBorder = `${ANSI.cyan}├${'┄'.repeat(innerWidth)}┤${ANSI.reset}`;
    const botBorder = `${ANSI.cyan}└${'─'.repeat(innerWidth)}┘${ANSI.reset}`;

    const lines = [
      topBorder,
      this.boxRow(`${ANSI.bold}${ANSI.brightWhite}BOOMBOX PROXY TELEMETRY DASHBOARD${ANSI.reset} ${ANSI.gray}v1.0.0${ANSI.reset}         ${ANSI.brightGreen}● ACTIVE${ANSI.reset}  ${ANSI.gray}[PORT :${this.port}]${ANSI.reset}`, innerWidth),
      this.boxRow(`${ANSI.gray}UPSTREAM:${ANSI.reset} ${ANSI.white}${padRight(truncatedOrigin, 26)}${ANSI.reset}  ${ANSI.gray}MODE:${ANSI.reset} ${ANSI.brightCyan}${padRight(modeUpper, 8)}${ANSI.reset}  ${ANSI.gray}UPTIME:${ANSI.reset} ${uptime}`, innerWidth),
      midBorder,
      this.boxRow(`${ANSI.bold}TRAFFIC TELEMETRY${ANSI.reset}                                 ${ANSI.bold}EFFICIENCY & SPEED${ANSI.reset}`, innerWidth),
      this.boxRow(`  ${ANSI.gray}Total Requests :${ANSI.reset} ${ANSI.bold}${padRight(String(this.requests), 6)}${ANSI.reset}             Hit Ratio: ${padRight(hitRatioStr, 6)} ${gauge}`, innerWidth),
      this.boxRow(`  ${ANSI.green}Hits           :${ANSI.reset} ${padRight(String(this.hits), 6)}             ${ANSI.gray}Avg Latency :${ANSI.reset} ${avgLatency}`, innerWidth),
      this.boxRow(`  ${ANSI.yellow}Misses         :${ANSI.reset} ${padRight(String(this.misses), 6)}             ${ANSI.cyan}Replays     :${ANSI.reset} ${padRight(String(this.replays), 6)}`, innerWidth),
      this.boxRow(`  ${ANSI.red}Faults / Errors:${ANSI.reset} ${padRight(String(this.faults), 6)}             ${ANSI.magenta}Records     :${ANSI.reset} ${padRight(String(this.records), 6)}`, innerWidth),
      midBorder,
      this.boxRow(`${ANSI.bold}TIME      SIGNAL    METHOD  STATUS    LATENCY   TARGET ROUTE${ANSI.reset}`, innerWidth),
      subBorder
    ];

    if (this.recent.length === 0) {
      lines.push(this.boxRow(`${ANSI.gray}  [Idle] Awaiting inbound HTTP requests on port ${this.port}...${ANSI.reset}`, innerWidth));
    } else {
      for (const item of this.recent) {
        const time = `${ANSI.gray}${item.timestamp}${ANSI.reset}`;
        const badge = this.formatBadge(item.cacheSignal);
        const method = this.formatMethod(item.method);
        const status = this.formatStatus(item.status);
        const duration = this.formatDuration(item.durationMs);
        const route = `${ANSI.white}${item.path}${ANSI.reset}`;

        const rowContent = `${time}  ${badge}  ${method}  ${status}  ${duration}  ${route}`;
        lines.push(this.boxRow(rowContent, innerWidth));
      }
    }

    lines.push(midBorder);
    const statusText = `${ANSI.brightYellow}STATUS:${ANSI.reset} ${this.statusMessage}`;
    lines.push(this.boxRow(statusText, innerWidth));
    lines.push(subBorder);
    const shortcuts = `${ANSI.gray}CONTROLS:${ANSI.reset}  ${ANSI.bold}[c]${ANSI.reset} Flush Cache  ${ANSI.bold}[r]${ANSI.reset} Reset Stats  ${ANSI.bold}[p]${ANSI.reset} Pause  ${ANSI.bold}[q]${ANSI.reset} Quit`;
    lines.push(this.boxRow(shortcuts, innerWidth));
    lines.push(botBorder);

    return lines.join('\n');
  }
}

export function startInteractiveDashboard({ telemetry, cache, refreshMs = 500 }) {
  let isRunning = true;
  let isPaused = false;

  // Enter alternate buffer and hide cursor
  process.stdout.write(ANSI.altScreen + ANSI.hideCursor + ANSI.clear);

  function draw() {
    if (!isRunning) return;
    process.stdout.write(ANSI.home + telemetry.render() + '\n');
  }

  draw();
  const timer = setInterval(() => {
    if (!isPaused) {
      draw();
    }
  }, refreshMs);

  function cleanup() {
    if (!isRunning) return;
    isRunning = false;
    clearInterval(timer);
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      try {
        process.stdin.setRawMode(false);
      } catch {}
      process.stdin.pause();
    }
    process.stdout.write(ANSI.showCursor + ANSI.exitAltScreen);
  }

  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });

  process.on('exit', () => {
    cleanup();
  });

  if (process.stdin.isTTY && process.stdin.setRawMode) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (key) => {
      // Ctrl+C or 'q'
      if (key === '\u0003' || key === 'q' || key === 'Q') {
        cleanup();
        process.exit(0);
      } else if (key === 'c' || key === 'C') {
        if (cache && typeof cache.clear === 'function') {
          cache.clear();
          telemetry.setStatus('Cache flushed successfully (0 items remaining).');
        } else {
          telemetry.setStatus('No local cache configured to clear.');
        }
        draw();
      } else if (key === 'r' || key === 'R') {
        telemetry.reset();
        telemetry.setStatus('Telemetry counters reset to zero.');
        draw();
      } else if (key === 'p' || key === 'P') {
        isPaused = !isPaused;
        telemetry.setStatus(isPaused ? 'Telemetry render PAUSED.' : 'Telemetry render RESUMED.');
        draw();
      }
    });
  }

  return { cleanup, draw };
}
