# EditorsHub native core.
#
# The library is built with -fno-exceptions -fno-rtti and a static libc++ so it can be loaded
# into the WebView's JNI class loader without pulling a second runtime into the process.
cmake_minimum_required(VERSION 3.22.1)
project(editorhubcore CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(editorhubcore SHARED
    ohc_core.cpp
    jni_bridge.cpp)

target_compile_options(editorhubcore PRIVATE
    -O2
    -ffast-math
    -fno-exceptions
    -fno-rtti
    -fvisibility=hidden
    -Wall
    -Wextra)

# The JNI entry points must survive -fvisibility=hidden or the JVM cannot bind them.
target_compile_options(editorhubcore PRIVATE -Wno-unused-parameter)

find_library(LOG_LIB log)
target_link_libraries(editorhubcore ${LOG_LIB} m)

# 16 KB page alignment: required for Android 15+ devices and for any Play submission.
target_link_options(editorhubcore PRIVATE "-Wl,-z,max-page-size=16384")
