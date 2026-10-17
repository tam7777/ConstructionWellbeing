"""Pure validation and retrieval rules, independent of model services."""
import json
import math
import re


def normalized_vector(values):
    if len(values) != 256:
        raise ValueError('Expected a 256-dimensional Cosmos Embed1 vector')
    result = [float(v) for v in values]
    if not all(math.isfinite(v) for v in result):
        raise ValueError('Embedding contains non-finite values')
    norm = math.sqrt(sum(v * v for v in result))
    if norm <= 1e-12:
        raise ValueError('Embedding has zero magnitude')
    return [v / norm for v in result]


def retrieve(query, candidates, limit=6):
    if query.get('active') is False:
        return []
    q = normalized_vector(query['vector'])
    matches = []
    for candidate in candidates:
        if candidate.get('active') is False:
            continue
        if candidate['id'] == query['id'] or candidate['task'] != query['task']:
            continue
        if candidate['ended_at'] > query['started_at']:
            continue
        same_track = (candidate['recording_id'] == query['recording_id']
                      and candidate.get('track_id') is not None
                      and candidate.get('track_id') == query.get('track_id'))
        confirmed_person = (query.get('identity_confirmed') and candidate.get('identity_confirmed')
                            and query.get('capture_time_known', True) and candidate.get('capture_time_known', True)
                            and not query.get('demo') and not candidate.get('demo')
                            and query.get('worker_id') is not None
                            and query.get('worker_id') == candidate.get('worker_id'))
        if not (same_track or confirmed_person):
            continue
        try:
            vector = normalized_vector(candidate['vector'])
        except (ValueError, TypeError):
            continue
        similarity = max(-1., min(1., sum(a * b for a, b in zip(q, vector))))
        matches.append(dict(candidate, similarity=similarity))
    return sorted(matches, key=lambda c: (-c['similarity'], -c['ended_at'], c['id']))[:limit]


def crop_bounds(boxes, width, height, padding=32):
    if not boxes or width < 2 or height < 2:
        raise ValueError('No usable person boxes')
    x = max(0, min(width - 2, math.floor(min(b[0] for b in boxes) - padding))) // 2 * 2
    y = max(0, min(height - 2, math.floor(min(b[1] for b in boxes) - padding))) // 2 * 2
    right = min(width, math.ceil(max(b[2] for b in boxes) + padding)) // 2 * 2
    bottom = min(height, math.ceil(max(b[3] for b in boxes) + padding)) // 2 * 2
    if right <= x or bottom <= y:
        raise ValueError('Person boxes are outside the image')
    return x, y, right - x, bottom - y


def parse_report(text):
    fenced = re.fullmatch(r'\s*```(?:json)?\s*\n(.*?)\n```\s*', text, re.DOTALL)
    try:
        data = json.loads(fenced.group(1) if fenced else text)
    except (ValueError, TypeError) as exc:
        raise ValueError('Reasoner did not return structured JSON') from exc
    if not isinstance(data, dict):
        raise ValueError('Reasoner result must be an object')
    for key in ('observable_changes', 'limitations'):
        if not isinstance(data.get(key), list) or not data[key] or len(data[key]) > 12:
            raise ValueError('Reasoner omitted evidence or limitations')
        if any(not isinstance(item, str) or not item.strip() or len(item) > 1500 for item in data[key]):
            raise ValueError('Invalid evidence description')
    for key in ('task_context', 'human_review_summary'):
        if not isinstance(data.get(key), str) or not data[key].strip() or len(data[key]) > 3000:
            raise ValueError('Reasoner omitted review context')
    if data.get('review_priority') not in ('routine', 'review', 'insufficient_evidence'):
        raise ValueError('Unsupported review priority')
    return {key: data[key] for key in ('observable_changes', 'task_context', 'limitations',
                                     'human_review_summary', 'review_priority')}
