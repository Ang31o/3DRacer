export default class LinearSpline {
  points: any[];
  constructor(private lerp: any) {
    this.points = [];
  }

  addPoint(t, d): void {
    this.points.push([t, d]);
  }

  get(t): number {
    let p1 = 0;

    for (let i = 0; i < this.points.length; i++) {
      if (this.points[i][0] >= t) {
        break;
      }
      p1 = i;
    }

    const p2 = Math.min(this.points.length - 1, p1 + 1);

    if (p1 == p2) {
      return this.points[p1][1];
    }

    return this.lerp(
      (t - this.points[p1][0]) / (this.points[p2][0] - this.points[p1][0]),
      this.points[p1][1],
      this.points[p2][1]
    );
  }
}
