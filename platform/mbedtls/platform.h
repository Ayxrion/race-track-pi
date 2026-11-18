#pragma once
// TLS is libcurl's job here; its memory needs no special placement.
#include <cstddef>
static inline int mbedtls_platform_set_calloc_free(void* (*)(size_t, size_t), void (*)(void*)) { return 0; }
