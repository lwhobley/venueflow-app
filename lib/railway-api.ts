export type RailwayFunctionRef = {
  readonly __railwayKey: string;
};

function makeNode(path: string[]): any {
  return new Proxy(function railwayFunctionRef() {}, {
    get(_target, property) {
      if (property === '__railwayKey') return path.join('.');
      if (property === 'toString') return () => path.join('.');
      if (property === Symbol.toPrimitive) return () => path.join('.');
      return makeNode([...path, String(property)]);
    },
  });
}

export const api = makeNode([]);
