"""Small explicit validators shared by persistence and HTTP."""
from datetime import date
import re


class APIError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def iso_date(value, field='date'):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value):
        raise APIError(f'{field} must be a YYYY-MM-DD date')
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise APIError(f'{field} must be a valid calendar date') from None


def task_fields(data):
    if not isinstance(data, dict):
        raise APIError('Expected a JSON object')
    allowed = {'title', 'notes', 'category', 'repeat', 'interval', 'startDate', 'priority'}
    if data.keys() - allowed:
        raise APIError('Unknown task field')
    result = {}
    for field, maximum, default in [('title', 200, None), ('notes', 2000, ''), ('category', 60, 'Personal')]:
        value = data.get(field, default)
        if field == 'title' and isinstance(value, str):
            value = value.strip()
        if (not isinstance(value, str) or len(value) > maximum or
                any((ord(c) < 32 and c not in '\n\r\t') or 0xD800 <= ord(c) <= 0xDFFF for c in value)):
            raise APIError(f'{field} must be text of at most {maximum} characters')
        result[field] = value
    if not result['title']:
        raise APIError('title must not be empty')
    repeat = data.get('repeat', 'once')
    if not isinstance(repeat, str) or repeat not in ('once', 'daily', 'weekly', 'monthly', 'yearly'):
        raise APIError('Invalid repeat')
    result['repeat'] = repeat
    for field, default, low, high in [('interval', 1, 1, 365), ('priority', 0, 0, 2)]:
        value = data.get(field, default)
        if type(value) is not int or not low <= value <= high:
            raise APIError(f'{field} must be an integer from {low} to {high}')
        result[field] = value
    result['startDate'] = iso_date(data.get('startDate'), 'startDate').isoformat()
    return result
