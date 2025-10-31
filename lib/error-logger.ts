// Comprehensive Error Logging System
// This system tracks all errors and provides detailed debugging information

export interface ErrorLog {
  id: string;
  timestamp: number;
  level: 'error' | 'warning' | 'info' | 'debug';
  component: string;
  function: string;
  message: string;
  details?: any;
  stack?: string;
  userId?: string;
  accountId?: string;
  transactionId?: string;
  apiEndpoint?: string;
  httpStatus?: number;
  firebaseError?: {
    code: string;
    message: string;
  };
  plaidError?: {
    error_code: string;
    error_message: string;
  };
  openaiError?: {
    error: string;
    message: string;
  };
}

class ErrorLogger {
  private logs: ErrorLog[] = [];
  private maxLogs = 1000; // Keep last 1000 logs

  log(error: Partial<ErrorLog>): void {
    const logEntry: ErrorLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      level: 'error',
      component: 'unknown',
      function: 'unknown',
      message: 'Unknown error',
      ...error,
    };

    this.logs.push(logEntry);
    
    // Keep only the last maxLogs entries
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Console logging with color coding
    const colors = {
      error: '\x1b[31m', // Red
      warning: '\x1b[33m', // Yellow
      info: '\x1b[36m', // Cyan
      debug: '\x1b[90m', // Gray
    };
    
    const reset = '\x1b[0m';
    const color = colors[logEntry.level] || colors.error;
    
    console.log(`${color}[${logEntry.level.toUpperCase()}] ${logEntry.component}:${logEntry.function}${reset}`);
    console.log(`${color}Message: ${logEntry.message}${reset}`);
    
    if (logEntry.details) {
      console.log(`${color}Details:`, logEntry.details, reset);
    }
    
    if (logEntry.stack) {
      console.log(`${color}Stack:`, logEntry.stack, reset);
    }
    
    if (logEntry.firebaseError) {
      console.log(`${color}Firebase Error:`, logEntry.firebaseError, reset);
    }
    
    if (logEntry.plaidError) {
      console.log(`${color}Plaid Error:`, logEntry.plaidError, reset);
    }
    
    if (logEntry.openaiError) {
      console.log(`${color}OpenAI Error:`, logEntry.openaiError, reset);
    }
  }

  // Specific error logging methods
  logFirebaseError(error: any, context: Partial<ErrorLog> = {}): void {
    this.log({
      ...context,
      level: 'error',
      component: 'firebase',
      message: error.message || 'Firebase error',
      firebaseError: {
        code: error.code || 'unknown',
        message: error.message || 'Unknown Firebase error',
      },
      stack: error.stack,
    });
  }

  logPlaidError(error: any, context: Partial<ErrorLog> = {}): void {
    this.log({
      ...context,
      level: 'error',
      component: 'plaid',
      message: error.error_message || 'Plaid error',
      plaidError: {
        error_code: error.error_code || 'unknown',
        error_message: error.error_message || 'Unknown Plaid error',
      },
    });
  }

  logOpenAIError(error: any, context: Partial<ErrorLog> = {}): void {
    this.log({
      ...context,
      level: 'error',
      component: 'openai',
      message: error.message || 'OpenAI error',
      openaiError: {
        error: error.error || 'unknown',
        message: error.message || 'Unknown OpenAI error',
      },
    });
  }

  logAPIError(error: any, endpoint: string, status?: number, context: Partial<ErrorLog> = {}): void {
    this.log({
      ...context,
      level: 'error',
      component: 'api',
      function: endpoint,
      message: error.message || `API error on ${endpoint}`,
      apiEndpoint: endpoint,
      httpStatus: status,
      stack: error.stack,
    });
  }

  logPollingError(error: any, pollCount: number, context: Partial<ErrorLog> = {}): void {
    this.log({
      ...context,
      level: 'error',
      component: 'polling',
      function: 'monitorAnalysisProgress',
      message: `Polling error at attempt ${pollCount}`,
      details: { pollCount, error: error.message },
      stack: error.stack,
    });
  }

  // Get recent logs for debugging
  getRecentLogs(count: number = 50): ErrorLog[] {
    return this.logs.slice(-count);
  }

  // Get logs by component
  getLogsByComponent(component: string): ErrorLog[] {
    return this.logs.filter(log => log.component === component);
  }

  // Get logs by level
  getLogsByLevel(level: ErrorLog['level']): ErrorLog[] {
    return this.logs.filter(log => log.level === level);
  }

  // Clear logs
  clearLogs(): void {
    this.logs = [];
  }

  // Export logs for debugging
  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }
}

// Singleton instance
export const errorLogger = new ErrorLogger();

// Helper functions for common error scenarios
export const logFirebaseError = (error: any, context: Partial<ErrorLog> = {}) => {
  errorLogger.logFirebaseError(error, context);
};

export const logPlaidError = (error: any, context: Partial<ErrorLog> = {}) => {
  errorLogger.logPlaidError(error, context);
};

export const logOpenAIError = (error: any, context: Partial<ErrorLog> = {}) => {
  errorLogger.logOpenAIError(error, context);
};

export const logAPIError = (error: any, endpoint: string, status?: number, context: Partial<ErrorLog> = {}) => {
  errorLogger.logAPIError(error, endpoint, status, context);
};

export const logPollingError = (error: any, pollCount: number, context: Partial<ErrorLog> = {}) => {
  errorLogger.logPollingError(error, pollCount, context);
};

// Global error handler
export const setupGlobalErrorHandler = () => {
  // Handle unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    errorLogger.log({
      level: 'error',
      component: 'global',
      function: 'unhandledrejection',
      message: 'Unhandled promise rejection',
      details: event.reason,
    });
  });

  // Handle uncaught errors
  window.addEventListener('error', (event) => {
    errorLogger.log({
      level: 'error',
      component: 'global',
      function: 'uncaught',
      message: 'Uncaught error',
      details: {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
      stack: event.error?.stack,
    });
  });
};

// Initialize global error handler
if (typeof window !== 'undefined') {
  setupGlobalErrorHandler();
}
