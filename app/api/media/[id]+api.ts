import { route } from '../../../server/http';
import { serveMedia } from '../../../server/media';

export const GET = route((request, { id }) => serveMedia(request, id));
