export class MetricsError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'MetricsError';
    this.code = code;
  }
}

export class MetricsCollector {
  constructor({
    db,
    clock = () => new Date(),
    flushIntervalMs = 30000,
    maxBufferSize = 10000
  } = {}) {
    this.db = db;
    this.clock = clock;
    this.flushIntervalMs = flushIntervalMs;
    this.maxBufferSize = maxBufferSize;
    this.buffer = [];
    this.flushInterval = null;
    this.running = false;
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
    this.listeners = new Map();
  }

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(handler);
  }

  _emit(event, data) {
    const handlers = this.listeners.get(event) ?? [];
    for (const h of handlers) {
      try { h(data); } catch (e) { console.error(`Metrics listener error (${event}):`, e); }
    }
  }

  incrementCounter(name, labels = {}, value = 1) {
    const key = this._makeKey(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
    this._bufferMetric({ type: 'counter', name, labels, value, timestamp: this.clock() });
  }

  setGauge(name, labels = {}, value) {
    const key = this._makeKey(name, labels);
    this.gauges.set(key, value);
    this._bufferMetric({ type: 'gauge', name, labels, value, timestamp: this.clock() });
  }

  observeHistogram(name, labels = {}, value) {
    const key = this._makeKey(name, labels);
    if (!this.histograms.has(key)) this.histograms.set(key, []);
    const arr = this.histograms.get(key);
    arr.push({ value, timestamp: this.clock() });
    if (arr.length > 1000) arr.shift();
    this._bufferMetric({ type: 'histogram', name, labels, value, timestamp: this.clock() });
  }

  _makeKey(name, labels) {
    const labelStr = Object.entries(labels).sort().map(([k, v]) => `${k}="${v}"`).join(',');
    return `${name}{${labelStr}}`;
  }

  _bufferMetric(metric) {
    this.buffer.push(metric);
    if (this.buffer.length >= this.maxBufferSize) {
      this.flush();
    }
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.flushInterval = setInterval(() => this.flush(), this.flushIntervalMs);
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    if (this.flushInterval) { clearInterval(this.flushInterval); this.flushInterval = null; }
    await this.flush();
  }

  async flush() {
    if (this.buffer.length === 0) return;
    
    const toFlush = this.buffer.splice(0, this.buffer.length);
    
    try {
      for (const metric of toFlush) {
        await this.db.query(
          `INSERT INTO metrics (metric_name, labels, metric_type, metric_value, timestamp)
           VALUES ($1, $2, $3, $4, $5)`,
          [metric.name, JSON.stringify(metric.labels), metric.type, metric.value, metric.timestamp]
        );
      }
      this._emit('flushed', { count: toFlush.length });
    } catch (error) {
      this.buffer.unshift(...toFlush);
      this._emit('flush_error', { error: error.message, count: toFlush.length });
    }
  }

  getCounter(name, labels = {}) {
    return this.counters.get(this._makeKey(name, labels)) ?? 0;
  }

  getGauge(name, labels = {}) {
    return this.gauges.get(this._makeKey(name, labels)) ?? 0;
  }

  getHistogramStats(name, labels = {}) {
    const arr = this.histograms.get(this._makeKey(name, labels)) ?? [];
    if (arr.length === 0) return { count: 0, sum: 0, min: null, max: null, avg: null, p50: null, p95: null, p99: null };
    
    const values = arr.map(m => m.value).sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    return {
      count: values.length,
      sum,
      min: values[0],
      max: values[values.length - 1],
      avg: sum / values.length,
      p50: values[Math.floor(values.length * 0.5)],
      p95: values[Math.floor(values.length * 0.95)],
      p99: values[Math.floor(values.length * 0.99)]
    };
  }
}

export class AlertManager {
  constructor({
    db,
    metricsCollector,
    clock = () => new Date(),
    checkIntervalMs = 60000
  } = {}) {
    this.db = db;
    this.metricsCollector = metricsCollector;
    this.clock = clock;
    this.checkIntervalMs = checkIntervalMs;
    this.rules = new Map();
    this.checkInterval = null;
    this.running = false;
    this.listeners = new Map();
    this.activeAlerts = new Map();
  }

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(handler);
  }

  _emit(event, data) {
    const handlers = this.listeners.get(event) ?? [];
    for (const h of handlers) {
      try { h(data); } catch (e) { console.error(`Alert listener error (${event}):`, e); }
    }
  }

  addRule(rule) {
    const { id, name, condition, severity = 'warning', message, cooldownMs = 300000 } = rule;
    if (!id || !condition) throw new MetricsError('Rule must have id and condition', { code: 'ERR_INVALID_RULE' });
    
    this.rules.set(id, {
      id, name, condition, severity, message, cooldownMs,
      lastTriggered: null, triggerCount: 0
    });
  }

  removeRule(id) {
    this.rules.delete(id);
    this.activeAlerts.delete(id);
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.checkInterval = setInterval(() => this._checkRules(), this.checkIntervalMs);
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    if (this.checkInterval) { clearInterval(this.checkInterval); this.checkInterval = null; }
  }

  async _checkRules() {
    const now = this.clock();
    
    for (const [id, rule] of this.rules.entries()) {
      try {
        const triggered = await this._evaluateCondition(rule.condition);
        
        if (triggered) {
          if (rule.lastTriggered && now.getTime() - rule.lastTriggered.getTime() < rule.cooldownMs) {
            continue;
          }
          
          rule.lastTriggered = now;
          rule.triggerCount++;
          
          const alert = {
            id: `${id}_${now.getTime()}`,
            ruleId: id,
            name: rule.name,
            severity: rule.severity,
            message: rule.message ?? `Alert: ${rule.name}`,
            timestamp: now.toISOString(),
            triggerCount: rule.triggerCount
          };
          
          this.activeAlerts.set(alert.id, alert);
          
          await this._storeAlert(alert);
          this._emit('alert', alert);
        } else {
          if (this.activeAlerts.has(id)) {
            this._emit('alert_resolved', { ruleId: id, resolvedAt: now.toISOString() });
            this.activeAlerts.delete(id);
          }
        }
      } catch (error) {
        this._emit('rule_error', { ruleId: id, error: error.message });
      }
    }
  }

  async _evaluateCondition(condition) {
    if (typeof condition === 'function') {
      return await condition(this.metricsCollector);
    }
    if (condition.type === 'threshold') {
      const value = this.metricsCollector.getGauge(condition.metric, condition.labels);
      return this._compare(value, condition.operator, condition.threshold);
    }
    if (condition.type === 'rate') {
      const counter = this.metricsCollector.getCounter(condition.metric, condition.labels);
      const rate = counter / (condition.windowMs / 1000);
      return this._compare(rate, condition.operator, condition.threshold);
    }
    return false;
  }

  _compare(value, operator, threshold) {
    switch (operator) {
      case 'gt': return value > threshold;
      case 'gte': return value >= threshold;
      case 'lt': return value < threshold;
      case 'lte': return value <= threshold;
      case 'eq': return value === threshold;
      case 'neq': return value !== threshold;
      default: return false;
    }
  }

  async _storeAlert(alert) {
    try {
      await this.db.query(
        `INSERT INTO alerts (alert_id, rule_id, name, severity, message, timestamp, trigger_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (alert_id) DO UPDATE SET trigger_count = $7`,
        [alert.id, alert.ruleId, alert.name, alert.severity, alert.message, alert.timestamp, alert.triggerCount]
      );
    } catch (error) {
      console.error('Failed to store alert:', error);
    }
  }

  getActiveAlerts() {
    return Array.from(this.activeAlerts.values());
  }

  getRule(id) {
    return this.rules.get(id);
  }

  getAllRules() {
    return Array.from(this.rules.values());
  }
}

export class SystemMetricsCollector {
  constructor({ metricsCollector, clock = () => new Date(), collectIntervalMs = 30000 } = {}) {
    this.metricsCollector = metricsCollector;
    this.clock = clock;
    this.collectIntervalMs = collectIntervalMs;
    this.running = false;
    this.collectInterval = null;
    this.processStartTime = clock();
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.collectInterval = setInterval(() => this.collect(), this.collectIntervalMs);
    this.collect();
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    if (this.collectInterval) { clearInterval(this.collectInterval); this.collectInterval = null; }
  }

  collect() {
    try {
      const mem = process.memoryUsage();
      this.metricsCollector.setGauge('process_memory_rss_bytes', {}, mem.rss);
      this.metricsCollector.setGauge('process_memory_heap_used_bytes', {}, mem.heapUsed);
      this.metricsCollector.setGauge('process_memory_heap_total_bytes', {}, mem.heapTotal);
      this.metricsCollector.setGauge('process_uptime_seconds', {}, (this.clock() - this.processStartTime) / 1000);
      this.metricsCollector.setGauge('process_cpu_user_seconds', {}, process.cpuUsage().user / 1e6);
      this.metricsCollector.setGauge('process_cpu_system_seconds', {}, process.cpuUsage().system / 1e6);
      
      this.metricsCollector.setGauge('event_loop_lag_ms', {}, this._measureEventLoopLag());
    } catch (error) {
      console.error('System metrics collection failed:', error);
    }
  }

  _measureEventLoopLag() {
    const start = process.hrtime.bigint();
    setImmediate(() => {});
    const end = process.hrtime.bigint();
    return Number(end - start) / 1e6;
  }
}