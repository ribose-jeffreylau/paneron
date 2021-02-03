import yaml from 'js-yaml';
import { decoder, encoder } from './encoders';


export function deserializeMeta<T = Record<string, any>>(data: Uint8Array): T {
  return yaml.load(decoder.decode(data));
}


export function serializeMeta(data: Record<string, any>) {
  return encoder.encode(yaml.dump(data, { noRefs: true }));
}
