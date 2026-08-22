export type RailwayFunctionRef = {
  readonly __railwayKey: string;
};

export type RailwayApiNode = RailwayFunctionRef & {
  readonly [segment: string]: RailwayApiNode;
};

function makeNode(path: string[]): RailwayApiNode {
  const target = function railwayFunctionRef() {} as unknown as RailwayApiNode;
  return new Proxy(target, {
    get(_target, property) {
      if (property === '__railwayKey') return path.join('.');
      if (property === 'toString') return () => path.join('.');
      if (property === Symbol.toPrimitive) return () => path.join('.');
      return makeNode([...path, String(property)]);
    },
  }) as RailwayApiNode;
}

export const api = makeNode([]);
