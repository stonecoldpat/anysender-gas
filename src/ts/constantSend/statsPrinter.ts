type Stat = {
  txId: string;
  statTime: number;
  startTime: number;
  afterSendTime: number;
  endTime: number;
  startBlock: number;
  endBlock: number;
};

type ErrorStat = {
  error: string;
  statTime: number;
};

interface ErrorStatsPrint {
  msg: string;
  count: number;
}

interface StatsPrint {
  successCount: number;
  errorCount: number;
  windowSizeSeconds: number;
  printIntervalSeconds: number;
  timeNow: string;
  oldestTime: string;

  meanSendTimeMs: number;
  smallestSendTimeMs: number;
  longestSendTimeMs: number;

  meanMineTimeS: number;
  smallestMineTimeS: number;
  longestMineTimeS: number;

  meanBlocks: number;
  smallestBlocks: number;
  longestBlocks: number;

  errorMessages: ErrorStatsPrint[];
}

export class StatsPrinter {
  public stats: (Stat | ErrorStat)[] = [];
  public errors: string[] = [];
  private lastPrintTime = 0;

  constructor(
    private readonly windowSizeSeconds: number,
    private readonly printIntervalSeconds: number
  ) {}

  public addTransactionStats(
    stat: Omit<Stat, "statTime"> | Omit<ErrorStat, "statTime">
  ) {
    const statTime = Date.now();
    this.stats.push({ ...stat, statTime });

    // remove old stats
    while (this.stats[0].statTime < statTime - this.windowSizeSeconds * 1000) {
      this.stats.shift();
    }

    // print the stat once in a while
    if (statTime - this.lastPrintTime > this.printIntervalSeconds * 1000) {
      this.lastPrintTime = statTime;
      const statsPrint = this.formatForPrint();
      this.printStats(statsPrint);
    }
  }

  private groupBy<
    T extends { [key: string]: string | number | undefined },
    TKey extends string
  >(xs: Array<T>, key: TKey) {
    return xs.reduce((acc, cur) => {
      (acc[cur[key]] = acc[cur[key]] || []).push(cur);
      return acc;
    }, {} as { [groupKey: string]: T[] });
  }

  public formatForPrint(): StatsPrint {
    const errorStats = this.stats
      .map((a) => a as ErrorStat)
      .filter((a) => a.error);
    const errorGroups = this.groupBy(errorStats, "error");
    const errors = Object.keys(errorGroups).map((a) => ({
      count: errorGroups[a].length,
      msg: a,
    }));

    const stats = this.stats.map((a) => a as Stat).filter((a) => a.txId);

    const blocks = stats.map((s) => s.endBlock - s.startBlock);
    const mineTimes = stats.map((s) => s.endTime - s.afterSendTime);
    const sendTimes = stats.map((s) => s.afterSendTime - s.startTime);

    return {
      successCount: stats.length,
      errorCount: errorStats.length,
      errorMessages: errors,

      longestBlocks: Math.max(blocks.reduce((a, b) => Math.max(a, b), 0) - 1, 0),
      meanBlocks: Math.max(blocks.reduce((a, b) => a + b, 0) / this.stats.length - 1, 0),
      smallestBlocks: blocks.reduce((a, b) => Math.min(a, b), Number.MAX_SAFE_INTEGER) - 1,

      longestMineTimeS: mineTimes.reduce((a, b) => Math.max(a, b), 0) / 1000,
      meanMineTimeS:
        mineTimes.reduce((a, b) => a + b, 0) / this.stats.length / 1000,
      smallestMineTimeS: blocks.reduce((a, b) => Math.min(a, b), Number.MAX_SAFE_INTEGER) / 1000,

      longestSendTimeMs: sendTimes.reduce((a, b) => Math.max(a, b), 0),
      meanSendTimeMs: sendTimes.reduce((a, b) => a + b, 0) / this.stats.length,
      smallestSendTimeMs: sendTimes.reduce((a, b) => Math.min(a, b), Number.MAX_SAFE_INTEGER),

      oldestTime: new Date(this.stats[0].statTime).toUTCString(),
      timeNow: new Date(
        this.stats[this.stats.length - 1].statTime
      ).toUTCString(),

      windowSizeSeconds: this.windowSizeSeconds,
      printIntervalSeconds: this.printIntervalSeconds,
    };
  }

  public printStats(statsPrint: StatsPrint) {
    console.log();
    console.log();
    console.log("=============================");
    console.log("============STATS============");
    console.log("=============================");
    console.log();
    console.log(`Time now: ${statsPrint.timeNow}`);
    console.log(`Oldest time: ${statsPrint.oldestTime}`);
    console.log(`Window size (s): ${statsPrint.windowSizeSeconds}`);
    console.log(`Print interval (s): ${statsPrint.printIntervalSeconds}`);
    console.log(`Success count: ${statsPrint.successCount}`);
    console.log(`Error count: ${statsPrint.errorCount}`);
    if (statsPrint.errorCount > 0) {
        console.log();
        console.log("ERRORS");
      statsPrint.errorMessages.forEach((e) =>
        console.log(`Count: ${e.count}. Msg: ${e.msg}.`)
      );
    }
    console.log();
    console.log(`Mean blocks: ${statsPrint.meanBlocks}`);
    console.log(`Longest blocks: ${statsPrint.longestBlocks}`);
    console.log(`Shortest blocks: ${statsPrint.smallestBlocks}`);
    console.log();
    console.log(`Mean send time (ms): ${statsPrint.meanSendTimeMs}`);
    console.log(`Longest send time (ms): ${statsPrint.longestSendTimeMs}`);
    console.log(`Shortest send time (ms): ${statsPrint.smallestSendTimeMs}`);
    console.log();
    console.log(`Mean mine time (s): ${statsPrint.meanMineTimeS}`);
    console.log(`Longest mine time (s): ${statsPrint.longestMineTimeS}`);
    console.log(`Shortest mine time (s): ${statsPrint.smallestMineTimeS}`);
    console.log();
    console.log();
    console.log();
  }
}
