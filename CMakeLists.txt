project (hulaloop-node)

include_directories (${CMAKE_JS_INC})
file (GLOB SOURCE_FILES ${PROJECT_SOURCE_DIR}/cpp/*.cpp)

add_library (${PROJECT_NAME} SHARED ${SOURCE_FILES} ${CMAKE_JS_SRC})
set_target_properties (${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")
target_link_libraries (${PROJECT_NAME} ${CMAKE_JS_LIB})