export class PseudoError extends Error {
  constructor(message, line = null) {
    const prefix = line != null ? `Line ${line}: ` : "";
    super(prefix + message);
    this.name = "PseudoError";
    this.line = line;
    this.studentMessage = prefix + message;
  }
}

export class ReturnSignal {
  constructor(value) {
    this.value = value;
  }
}

export class StopSignal extends Error {
  constructor() {
    super("Program stopped.");
    this.name = "StopSignal";
  }
}
