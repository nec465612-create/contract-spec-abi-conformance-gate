# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
import hashlib
import json
import re


MAX_U256 = 2**256 - 1
ID_RE = re.compile(r"^[a-z][a-z0-9_]{0,15}$")
NONCE_RE = re.compile(r"^[0-9a-f]{32}$")
HEX64_RE = re.compile(r"^[0-9a-f]{64}$")
TYPE_RE = re.compile(r"^([A-Za-z0-9]+)((?:\[\]|\[[0-9]+\]){0,4})$")
SUFFIX_RE = re.compile(r"\[\]|\[([0-9]+)\]")
POLARITIES = ("REQUIRED", "FORBIDDEN")
TERMINAL = ("DONE",)


def _canonical(value) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def _sha(value) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise gl.vm.UserError("DUPLICATE_KEY")
        result[key] = value
    return result


def _parse_json(raw: str, cap: int):
    if not isinstance(raw, str):
        raise gl.vm.UserError("BAD_JSON")
    normalized = raw.replace("\r\n", "\n")
    if len(normalized.encode("utf-8")) > cap:
        raise gl.vm.UserError("CAPACITY")
    try:
        return json.loads(normalized, object_pairs_hook=_pairs)
    except gl.vm.UserError:
        raise
    except Exception:
        raise gl.vm.UserError("BAD_JSON")


def _exact_keys(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise gl.vm.UserError("BAD_SCHEMA")


def _is_int(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _u256_value(value, *, minimum=0, maximum=MAX_U256) -> int:
    if not _is_int(value):
        raise gl.vm.UserError("BAD_INTEGER")
    if value < minimum or value > maximum:
        raise gl.vm.UserError("BAD_INTEGER")
    return value


def _address_hex(value) -> str:
    if isinstance(value, (bytes, bytearray)):
        raw = bytes(value)
        if len(raw) != 20:
            raise gl.vm.UserError("BAD_ADDRESS")
        return "0x" + raw.hex()
    try:
        text = value.as_hex
    except Exception:
        text = str(value)
    text = text.lower()
    if not re.fullmatch(r"0x[0-9a-f]{40}", text):
        raise gl.vm.UserError("BAD_ADDRESS")
    return text


def _text(value, maximum: int, *, empty=False) -> str:
    if not isinstance(value, str):
        raise gl.vm.UserError("BAD_TEXT")
    size = len(value.encode("utf-8"))
    if size > maximum or (not empty and size == 0):
        raise gl.vm.UserError("BAD_TEXT")
    for char in value:
        if ord(char) < 32 and char not in ("\n", "\t"):
            raise gl.vm.UserError("BAD_TEXT")
    return value


def _identifier(value) -> str:
    if not isinstance(value, str) or not ID_RE.fullmatch(value):
        raise gl.vm.UserError("BAD_ID")
    return value


def _validate_param(value, *, event=False, depth=0, counter=None) -> str:
    if counter is None:
        counter = [0]
    counter[0] += 1
    if counter[0] > 32 or depth > 4:
        raise gl.vm.UserError("BAD_TYPE")
    if not isinstance(value, dict):
        raise gl.vm.UserError("BAD_SCHEMA")
    type_name = value.get("type")
    if not isinstance(type_name, str):
        raise gl.vm.UserError("BAD_TYPE")
    match = TYPE_RE.fullmatch(type_name)
    if not match:
        raise gl.vm.UserError("BAD_TYPE")
    base, suffix_text = match.groups()
    suffixes = list(SUFFIX_RE.finditer(suffix_text))
    if len(suffixes) > 4 or "".join(item.group(0) for item in suffixes) != suffix_text:
        raise gl.vm.UserError("BAD_TYPE")
    for suffix in suffixes:
        if suffix.group(1) is not None:
            number = suffix.group(1)
            if number.startswith("0") or not 1 <= int(number) <= 64:
                raise gl.vm.UserError("BAD_TYPE")

    expected = {"name", "type", "indexed"} if event else {"name", "type"}
    if base == "tuple":
        expected.add("components")
    _exact_keys(value, expected)
    _text(value["name"], 16, empty=True)
    if event and not isinstance(value["indexed"], bool):
        raise gl.vm.UserError("BAD_SCHEMA")

    if base == "tuple":
        components = value["components"]
        if not isinstance(components, list) or not 1 <= len(components) <= 8:
            raise gl.vm.UserError("BAD_TYPE")
        inner = ",".join(
            _validate_param(item, event=False, depth=depth + 1, counter=counter)
            for item in components
        )
        canonical_base = "(" + inner + ")"
    else:
        if base in ("uint", "int"):
            canonical_base = base + "256"
        elif base in ("address", "bool", "string", "bytes"):
            canonical_base = base
        elif re.fullmatch(r"bytes(?:[1-9]|[12][0-9]|3[0-2])", base):
            canonical_base = base
        else:
            sized = re.fullmatch(r"(u?int)([0-9]+)", base)
            if not sized or int(sized.group(2)) % 8 or not 8 <= int(sized.group(2)) <= 256:
                raise gl.vm.UserError("BAD_TYPE")
            canonical_base = base
    return canonical_base + suffix_text


def _validate_entry(entry):
    if not isinstance(entry, dict) or not isinstance(entry.get("type"), str):
        raise gl.vm.UserError("BAD_SCHEMA")
    kind = entry["type"]
    if kind == "function":
        _exact_keys(entry, {"type", "name", "inputs", "outputs", "stateMutability"})
        name = _identifier(entry["name"])
        if entry["stateMutability"] not in ("pure", "view", "nonpayable", "payable"):
            raise gl.vm.UserError("BAD_SCHEMA")
        if not isinstance(entry["inputs"], list) or len(entry["inputs"]) > 8:
            raise gl.vm.UserError("BAD_SCHEMA")
        if not isinstance(entry["outputs"], list) or len(entry["outputs"]) > 4:
            raise gl.vm.UserError("BAD_SCHEMA")
        counter = [0]
        inputs = [_validate_param(item, counter=counter) for item in entry["inputs"]]
        outputs = [_validate_param(item, counter=counter) for item in entry["outputs"]]
        callable_key = name + "(" + ",".join(inputs) + ")"
        signature = (
            callable_key
            + "->("
            + ",".join(outputs)
            + "):"
            + entry["stateMutability"]
        )
        return callable_key, signature
    if kind == "constructor":
        _exact_keys(entry, {"type", "inputs", "stateMutability"})
        if entry["stateMutability"] not in ("nonpayable", "payable"):
            raise gl.vm.UserError("BAD_SCHEMA")
        if not isinstance(entry["inputs"], list) or len(entry["inputs"]) > 8:
            raise gl.vm.UserError("BAD_SCHEMA")
        counter = [0]
        [_validate_param(item, counter=counter) for item in entry["inputs"]]
        return None
    if kind == "event":
        _exact_keys(entry, {"type", "name", "inputs", "anonymous"})
        _identifier(entry["name"])
        if not isinstance(entry["anonymous"], bool) or not isinstance(entry["inputs"], list) or len(entry["inputs"]) > 8:
            raise gl.vm.UserError("BAD_SCHEMA")
        counter = [0]
        [_validate_param(item, event=True, counter=counter) for item in entry["inputs"]]
        return None
    if kind == "error":
        _exact_keys(entry, {"type", "name", "inputs"})
        _identifier(entry["name"])
        if not isinstance(entry["inputs"], list) or len(entry["inputs"]) > 8:
            raise gl.vm.UserError("BAD_SCHEMA")
        counter = [0]
        [_validate_param(item, counter=counter) for item in entry["inputs"]]
        return None
    if kind == "fallback":
        _exact_keys(entry, {"type", "stateMutability"})
        if entry["stateMutability"] not in ("nonpayable", "payable"):
            raise gl.vm.UserError("BAD_SCHEMA")
        return None
    if kind == "receive":
        _exact_keys(entry, {"type", "stateMutability"})
        if entry["stateMutability"] != "payable":
            raise gl.vm.UserError("BAD_SCHEMA")
        return None
    raise gl.vm.UserError("BAD_SCHEMA")


def _validate_base(value):
    _exact_keys(value, {"requirements", "abi"})
    requirements = value["requirements"]
    abi = value["abi"]
    if not isinstance(requirements, list) or not 1 <= len(requirements) <= 8:
        raise gl.vm.UserError("BAD_SCHEMA")
    seen_ids = set()
    for requirement in requirements:
        _exact_keys(requirement, {"id", "text", "polarity", "signature"})
        rid = _identifier(requirement["id"])
        if rid in seen_ids:
            raise gl.vm.UserError("DUPLICATE_ID")
        seen_ids.add(rid)
        _text(requirement["text"], 384)
        if requirement["polarity"] not in POLARITIES:
            raise gl.vm.UserError("BAD_SCHEMA")
        _validate_signature(requirement["signature"])
    if not isinstance(abi, list) or not 1 <= len(abi) <= 16:
        raise gl.vm.UserError("BAD_SCHEMA")
    seen_callables = set()
    signatures = []
    for entry in abi:
        result = _validate_entry(entry)
        if result is not None:
            callable_key, signature = result
            if callable_key in seen_callables:
                raise gl.vm.UserError("DUPLICATE_CALLABLE")
            seen_callables.add(callable_key)
            signatures.append(signature)
    if not 1 <= len(signatures) <= 8:
        raise gl.vm.UserError("BAD_SCHEMA")
    return signatures


def _split_types(value: str):
    if value == "":
        return []
    parts = []
    depth = 0
    start = 0
    for index, char in enumerate(value):
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth < 0:
                raise gl.vm.UserError("BAD_SIGNATURE")
        elif char == "," and depth == 0:
            parts.append(value[start:index])
            start = index + 1
    if depth != 0:
        raise gl.vm.UserError("BAD_SIGNATURE")
    parts.append(value[start:])
    if any(part == "" for part in parts):
        raise gl.vm.UserError("BAD_SIGNATURE")
    return parts


def _validate_canonical_type(value: str, depth=0) -> None:
    if depth > 4 or not isinstance(value, str) or value == "":
        raise gl.vm.UserError("BAD_SIGNATURE")
    suffix_start = len(value)
    if value.startswith("("):
        nesting = 0
        close = -1
        for index, char in enumerate(value):
            if char == "(":
                nesting += 1
            elif char == ")":
                nesting -= 1
                if nesting == 0:
                    close = index
                    break
        if close < 2:
            raise gl.vm.UserError("BAD_SIGNATURE")
        for item in _split_types(value[1:close]):
            _validate_canonical_type(item, depth + 1)
        suffix_start = close + 1
    else:
        bracket = value.find("[")
        suffix_start = bracket if bracket >= 0 else len(value)
        base = value[:suffix_start]
        valid = base in ("address", "bool", "string", "bytes") or re.fullmatch(r"bytes(?:[1-9]|[12][0-9]|3[0-2])", base)
        sized = re.fullmatch(r"(u?int)([0-9]+)", base)
        if not valid and not (sized and 8 <= int(sized.group(2)) <= 256 and int(sized.group(2)) % 8 == 0):
            raise gl.vm.UserError("BAD_SIGNATURE")
    suffix = value[suffix_start:]
    matches = list(SUFFIX_RE.finditer(suffix))
    if len(matches) > 4 or "".join(match.group(0) for match in matches) != suffix:
        raise gl.vm.UserError("BAD_SIGNATURE")
    for match in matches:
        if match.group(1) is not None and (match.group(1).startswith("0") or not 1 <= int(match.group(1)) <= 64):
            raise gl.vm.UserError("BAD_SIGNATURE")


def _validate_signature(value: str) -> str:
    _text(value, 512)
    match = re.fullmatch(r"([a-z][a-z0-9_]{0,15})\((.*)\)->\((.*)\):(pure|view|nonpayable|payable)", value)
    if match is None:
        raise gl.vm.UserError("BAD_SIGNATURE")
    for item in _split_types(match.group(2)) + _split_types(match.group(3)):
        _validate_canonical_type(item)
    return value


def _deterministic_result(base, signatures):
    labels = []
    for requirement in base["requirements"]:
        target = requirement["signature"]
        matched = "IMPLEMENTS" if requirement["polarity"] == "REQUIRED" else "VIOLATES"
        labels.extend(matched if signature == target else "NONE" for signature in signatures)
    return {"v": 1, "labels": labels}


def _outcome(base, labels, function_count: int) -> str:
    rows = [labels[i * function_count : (i + 1) * function_count] for i in range(len(base["requirements"]))]
    for requirement, row in zip(base["requirements"], rows):
        if requirement["polarity"] == "FORBIDDEN" and "VIOLATES" in row:
            return "FORBIDDEN_SURFACE"
    for requirement, row in zip(base["requirements"], rows):
        if requirement["polarity"] == "REQUIRED" and "IMPLEMENTS" not in row:
            return "MISSING_REQUIRED_SURFACE"
    return "CONFORMANT"


class ContractSpecAbiConformanceGate(gl.Contract):
    case_count: u256
    cases: TreeMap[u256, str]
    nonce_index: TreeMap[str, u256]
    actor_index: TreeMap[str, str]
    child_index: TreeMap[u256, str]
    version_index: TreeMap[u256, u256]
    history: TreeMap[str, str]

    def __init__(self) -> None:
        self.case_count = u256(0)

    def _record(self, case_id: int):
        raw = self.cases.get(u256(case_id), "")
        if raw == "":
            raise gl.vm.UserError("NOT_FOUND")
        return json.loads(raw)

    def _encode_record(self, record) -> str:
        encoded = _canonical(record)
        if len(encoded.encode("utf-8")) > 24576:
            raise gl.vm.UserError("CAPACITY")
        return encoded

    def _operation(self, method: str, args) -> dict:
        return {
            "method": method,
            "caller": _address_hex(gl.message.sender_address),
            "args_hash": _sha(args),
        }

    def _commit(self, record) -> None:
        encoded = self._encode_record(record)
        case_id = u256(int(record["id"]))
        revision = u256(int(record["revision"]))
        self.cases[case_id] = encoded
        self.version_index[case_id] = revision
        self.history[record["id"] + ":" + record["revision"]] = encoded

    @gl.public.write
    def create_case(self, nonce: str, base_json: str, parent: u256) -> u256:
        if not isinstance(nonce, str) or not NONCE_RE.fullmatch(nonce):
            raise gl.vm.UserError("BAD_NONCE")
        parent_id = _u256_value(parent)
        base = _parse_json(base_json, 8192)
        _validate_base(base)
        if len(_canonical(base).encode("utf-8")) > 8192:
            raise gl.vm.UserError("CAPACITY")
        caller = _address_hex(gl.message.sender_address)
        args = [nonce, base, str(parent_id)]
        create_hash = _sha(args)
        nonce_key = caller + ":" + nonce
        existing = int(self.nonce_index.get(nonce_key, u256(0)))
        if existing:
            record = self._record(existing)
            if record["create_hash"] == create_hash:
                return u256(existing)
            raise gl.vm.UserError("NONCE_CONFLICT")
        count = int(self.case_count)
        if count >= 32:
            raise gl.vm.UserError("CAPACITY")

        actor_ids = json.loads(self.actor_index.get(caller, "[]"))
        if len(actor_ids) >= 32:
            raise gl.vm.UserError("CAPACITY")
        children = []
        if parent_id:
            parent_record = self._record(parent_id)
            if parent_record["phase"] not in TERMINAL or parent_record["primary"] != caller or parent_record["secondary"] != caller:
                raise gl.vm.UserError("BAD_PARENT")
            children = json.loads(self.child_index.get(u256(parent_id), "[]"))
            if len(children) >= 32:
                raise gl.vm.UserError("CAPACITY")

        case_id = count + 1
        actor_ids.append(str(case_id))
        if parent_id:
            children.append(str(case_id))
        record = {
            "v": 1,
            "id": str(case_id),
            "primary": caller,
            "secondary": caller,
            "phase": "BASE_DRAFT",
            "revision": "1",
            "parent": str(parent_id),
            "create_hash": create_hash,
            "base": base,
            "response": {},
            "base_locked": False,
            "response_locked": False,
            "outcome": "",
            "result": {},
            "domain": {},
            "last_operation": self._operation("create_case", args),
        }
        encoded = self._encode_record(record)
        self.case_count = u256(case_id)
        self.nonce_index[nonce_key] = u256(case_id)
        self.actor_index[caller] = _canonical(actor_ids)
        if parent_id:
            self.child_index[u256(parent_id)] = _canonical(children)
        self.cases[u256(case_id)] = encoded
        self.version_index[u256(case_id)] = u256(1)
        self.history[str(case_id) + ":1"] = encoded
        return u256(case_id)

    @gl.public.write
    def replace_base(self, id: u256, base_json: str, expected_revision: u256) -> None:
        case_id = _u256_value(id, minimum=1)
        expected = _u256_value(expected_revision)
        record = self._record(case_id)
        if int(record["revision"]) != expected:
            raise gl.vm.UserError("STALE_REVISION")
        if record["primary"] != _address_hex(gl.message.sender_address):
            raise gl.vm.UserError("UNAUTHORIZED")
        if record["phase"] != "BASE_DRAFT":
            raise gl.vm.UserError("BAD_PHASE")
        if expected + 2 > 32:
            raise gl.vm.UserError("CAPACITY")
        base = _parse_json(base_json, 8192)
        _validate_base(base)
        if len(_canonical(base).encode("utf-8")) > 8192:
            raise gl.vm.UserError("CAPACITY")
        record["base"] = base
        record["revision"] = str(expected + 1)
        record["last_operation"] = self._operation("replace_base", [str(case_id), base, str(expected)])
        self._commit(record)

    @gl.public.write
    def freeze_case(self, id: u256, expected_revision: u256) -> None:
        case_id = _u256_value(id, minimum=1)
        expected = _u256_value(expected_revision)
        record = self._record(case_id)
        if int(record["revision"]) != expected:
            raise gl.vm.UserError("STALE_REVISION")
        if record["primary"] != _address_hex(gl.message.sender_address):
            raise gl.vm.UserError("UNAUTHORIZED")
        if record["phase"] != "BASE_DRAFT":
            raise gl.vm.UserError("BAD_PHASE")
        if expected + 1 > 32:
            raise gl.vm.UserError("CAPACITY")
        signatures = _validate_base(record["base"])
        result = _deterministic_result(record["base"], signatures)
        record["base_locked"] = True
        record["response_locked"] = True
        record["phase"] = "DONE"
        record["outcome"] = _outcome(record["base"], result["labels"], len(signatures))
        record["result"] = result
        record["revision"] = str(expected + 1)
        record["last_operation"] = self._operation("freeze_case", [str(case_id), str(expected)])
        self._commit(record)

    @gl.public.view
    def get_case(self, case_id: u256) -> str:
        cid = _u256_value(case_id)
        if cid == 0:
            return "null"
        return self.cases.get(u256(cid), "null")

    @gl.public.view
    def get_version(self, case_id: u256, revision: u256) -> str:
        cid = _u256_value(case_id)
        rev = _u256_value(revision)
        if cid == 0 or rev == 0:
            return "null"
        return self.history.get(str(cid) + ":" + str(rev), "null")

    @gl.public.view
    def get_id_by_nonce(self, creator: Address, nonce: str) -> u256:
        if not isinstance(nonce, str) or not NONCE_RE.fullmatch(nonce):
            raise gl.vm.UserError("BAD_NONCE")
        return self.nonce_index.get(_address_hex(creator) + ":" + nonce, u256(0))

    @gl.public.view
    def get_count(self) -> u256:
        return self.case_count

    @gl.public.view
    def list_cases(self, start_id: u256, limit: u256) -> str:
        start = _u256_value(start_id, minimum=1, maximum=33)
        size = _u256_value(limit, minimum=1, maximum=4)
        count = int(self.case_count)
        ids = [str(value) for value in range(start, min(count + 1, start + size))]
        next_id = start + len(ids)
        return _canonical({"ids": ids, "next": str(next_id if next_id <= count else 0)})

    @gl.public.view
    def list_actor(self, actor: Address, offset: u256, limit: u256) -> str:
        return self._list_index(json.loads(self.actor_index.get(_address_hex(actor), "[]")), offset, limit)

    @gl.public.view
    def list_children(self, parent_id: u256, offset: u256, limit: u256) -> str:
        parent = _u256_value(parent_id)
        values = json.loads(self.child_index.get(u256(parent), "[]")) if parent else []
        return self._list_index(values, offset, limit)

    def _list_index(self, values, offset, limit) -> str:
        start = _u256_value(offset, maximum=32)
        size = _u256_value(limit, minimum=1, maximum=4)
        ids = values[start : start + size]
        next_offset = start + len(ids)
        return _canonical({"ids": ids, "next": str(next_offset if next_offset < len(values) else 0)})
